#!/usr/bin/env python3
"""Performance comparison test for GolfClip desktop vs webapp."""

import requests
import time
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional


class PerformanceTest:
    """Base performance test class."""

    def __init__(self, base_url: str, name: str):
        self.base_url = base_url.rstrip("/")
        self.name = name
        self.timings = {}
        self.results = {}

    def timer(self, name: str):
        """Context manager for timing operations."""
        class Timer:
            def __init__(self, test, name):
                self.test = test
                self.name = name
                self.start = None
            def __enter__(self):
                self.start = time.time()
                return self
            def __exit__(self, *args):
                elapsed = time.time() - self.start
                self.test.timings[self.name] = elapsed
                print(f"  {self.name}: {elapsed:.2f}s")
        return Timer(self, name)

    def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            response = requests.get(f"{self.base_url}/api/health", timeout=10)
            return response.status_code == 200
        except Exception as e:
            print(f"  Health check failed: {e}")
            return False


class DesktopTest(PerformanceTest):
    """Desktop app performance test."""

    def __init__(self, base_url: str = "http://localhost:8420"):
        super().__init__(base_url, "Desktop")

    def health_check(self) -> bool:
        """Check if the service is healthy (desktop uses /health, not /api/health)."""
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            return response.status_code == 200
        except Exception as e:
            print(f"  Health check failed: {e}")
            return False

    def upload_video(self, video_path: str) -> str:
        """Upload video and return server path."""
        with self.timer("upload"):
            with open(video_path, 'rb') as f:
                files = {'file': (Path(video_path).name, f, 'video/quicktime')}
                response = requests.post(f"{self.base_url}/api/upload", files=files)
                response.raise_for_status()
                return response.json()['path']

    def process_video(self, video_path: str) -> dict:
        """Process video and track progress."""
        with self.timer("process_start"):
            response = requests.post(
                f"{self.base_url}/api/process",
                json={"video_path": video_path}
            )
            response.raise_for_status()
            job = response.json()

        job_id = job['job_id']
        print(f"  Job ID: {job_id}")

        # Poll for completion
        process_start = time.time()
        step_timings = {}
        last_step = None
        step_start = time.time()

        while True:
            response = requests.get(f"{self.base_url}/api/status/{job_id}")
            response.raise_for_status()
            status = response.json()

            current_step = status.get('current_step', '')
            if current_step != last_step:
                if last_step:
                    step_timings[last_step] = time.time() - step_start
                last_step = current_step
                step_start = time.time()
                print(f"    Step: {current_step} ({status.get('progress', 0):.1f}%)")

            if status['status'] in ['complete', 'review', 'error']:
                if last_step:
                    step_timings[last_step] = time.time() - step_start
                break

            time.sleep(1)

        total_process_time = time.time() - process_start
        self.timings['process_total'] = total_process_time
        self.timings['process_steps'] = step_timings
        print(f"  process_total: {total_process_time:.2f}s")

        # Get shots - desktop returns list directly
        with self.timer("get_shots"):
            response = requests.get(f"{self.base_url}/api/shots/{job_id}")
            response.raise_for_status()
            shots = response.json()  # Returns list directly

        self.results['job_id'] = job_id
        self.results['status'] = status['status']
        self.results['shots'] = shots
        self.results['shot_count'] = len(shots)

        return status

    def export_clips(self, job_id: str, video_path: str, output_dir: str) -> dict:
        """Export clips and track timing."""
        shots = self.results.get('shots', [])
        if not shots:
            print("  No shots to export")
            return {}

        clips = [
            {
                "shot_id": shot['id'],
                "start_time": shot['clip_start'],
                "end_time": shot['clip_end'],
                "approved": True
            }
            for shot in shots
        ]

        with self.timer("export"):
            response = requests.post(
                f"{self.base_url}/api/export",
                json={
                    "job_id": job_id,
                    "clips": clips,
                    "output_dir": output_dir,
                    "render_tracer": False
                }
            )
            response.raise_for_status()
            export_job = response.json()

        export_job_id = export_job.get('export_job_id')
        if not export_job_id:
            return export_job

        # Poll for export completion
        export_start = time.time()
        while True:
            response = requests.get(f"{self.base_url}/api/export/{export_job_id}/status")
            response.raise_for_status()
            status = response.json()

            if status['status'] in ['complete', 'error']:
                break

            time.sleep(0.5)

        export_time = time.time() - export_start
        self.timings['export_poll'] = export_time

        return status

    def run_test(self, video_path: str, output_dir: str) -> dict:
        """Run full test on a video."""
        video_size_mb = Path(video_path).stat().st_size / (1024 * 1024)

        print(f"\n[1/3] Upload")
        server_path = self.upload_video(video_path)

        print(f"\n[2/3] Processing")
        status = self.process_video(server_path)

        print(f"\n[3/3] Export")
        job_id = self.results['job_id']
        self.export_clips(job_id, server_path, output_dir)

        return self._compile_results(video_path, video_size_mb, status)

    def _compile_results(self, video_path: str, video_size_mb: float, status: dict) -> dict:
        """Compile test results."""
        total_time = sum([
            self.timings.get('upload', 0),
            self.timings.get('process_total', 0),
            self.timings.get('export', 0) + self.timings.get('export_poll', 0)
        ])

        return {
            'video': Path(video_path).name,
            'size_mb': video_size_mb,
            'status': status['status'],
            'shot_count': self.results['shot_count'],
            'shots': self.results['shots'],
            'timings': dict(self.timings),
            'total_time': total_time
        }


class WebappTest(PerformanceTest):
    """Webapp performance test."""

    def __init__(self, base_url: str = "https://golfclip-api.fly.dev"):
        super().__init__(base_url, "Webapp")

    def upload_video(self, video_path: str) -> str:
        """Upload video directly to R2 via presigned URL (bypasses server memory)."""
        file_path = Path(video_path)
        file_size = file_path.stat().st_size
        filename = file_path.name

        with self.timer("upload"):
            # Step 1: Get presigned upload URL from backend
            print(f"    Initiating direct upload ({file_size / (1024*1024):.1f} MB)...")
            init_response = requests.get(
                f"{self.base_url}/api/upload/initiate",
                params={"filename": filename, "size_bytes": file_size},
                timeout=120  # Allow time for cold start
            )
            init_response.raise_for_status()
            init_data = init_response.json()
            storage_key = init_data['storage_key']
            upload_url = init_data['upload_url']

            # Step 2: Upload directly to R2 with progress tracking
            print(f"    Uploading to R2...")
            uploaded = 0
            last_percent = 0

            def upload_progress_callback(chunk_size):
                nonlocal uploaded, last_percent
                uploaded += chunk_size
                percent = int((uploaded / file_size) * 100)
                if percent >= last_percent + 10:  # Print every 10%
                    print(f"      {percent}% uploaded...")
                    last_percent = percent

            # Read and upload file with progress
            with open(video_path, 'rb') as f:
                # For large files, we stream the upload
                response = requests.put(
                    upload_url,
                    data=self._file_reader_with_progress(f, file_size, upload_progress_callback),
                    headers={'Content-Length': str(file_size)},
                    timeout=600  # 10 minute timeout for large uploads
                )
                response.raise_for_status()

            print(f"      100% uploaded")

            # Step 3: Verify upload completed
            print(f"    Verifying upload...")
            complete_response = requests.post(
                f"{self.base_url}/api/upload/complete",
                json={"storage_key": storage_key},
                timeout=30
            )
            complete_response.raise_for_status()

            return storage_key

    def _file_reader_with_progress(self, file_obj, total_size, callback):
        """Generator that reads file and reports progress."""
        chunk_size = 1024 * 1024  # 1MB chunks
        while True:
            chunk = file_obj.read(chunk_size)
            if not chunk:
                break
            callback(len(chunk))
            yield chunk

    def process_video(self, storage_key: str) -> dict:
        """Process video and track progress."""
        with self.timer("process_start"):
            response = requests.post(
                f"{self.base_url}/api/process",
                params={"storage_key": storage_key}
            )
            response.raise_for_status()
            job = response.json()

        job_id = job['job_id']
        print(f"  Job ID: {job_id}")

        # Poll for completion
        process_start = time.time()
        step_timings = {}
        last_step = None
        step_start = time.time()

        while True:
            response = requests.get(f"{self.base_url}/api/status/{job_id}")
            response.raise_for_status()
            status = response.json()

            current_step = status.get('current_step', '')
            if current_step != last_step:
                if last_step:
                    step_timings[last_step] = time.time() - step_start
                last_step = current_step
                step_start = time.time()
                print(f"    Step: {current_step} ({status.get('progress', 0):.1f}%)")

            if status['status'] in ['complete', 'review', 'error']:
                if last_step:
                    step_timings[last_step] = time.time() - step_start
                break

            time.sleep(2)  # Longer polling interval for cloud

        total_process_time = time.time() - process_start
        self.timings['process_total'] = total_process_time
        self.timings['process_steps'] = step_timings
        print(f"  process_total: {total_process_time:.2f}s")

        # Get shots - webapp returns {"shots": [...]}
        with self.timer("get_shots"):
            response = requests.get(f"{self.base_url}/api/shots/{job_id}")
            response.raise_for_status()
            data = response.json()
            shots = data.get('shots', [])

        self.results['job_id'] = job_id
        self.results['status'] = status['status']
        self.results['shots'] = shots
        self.results['shot_count'] = len(shots)

        return status

    def run_test(self, video_path: str, output_dir: str = None) -> dict:
        """Run full test on a video (no export for webapp - that's client-side)."""
        video_size_mb = Path(video_path).stat().st_size / (1024 * 1024)

        print(f"\n[1/2] Upload to R2")
        storage_key = self.upload_video(video_path)

        print(f"\n[2/2] Processing")
        status = self.process_video(storage_key)

        return self._compile_results(video_path, video_size_mb, status)

    def _compile_results(self, video_path: str, video_size_mb: float, status: dict) -> dict:
        """Compile test results."""
        total_time = sum([
            self.timings.get('upload', 0),
            self.timings.get('process_total', 0),
        ])

        return {
            'video': Path(video_path).name,
            'size_mb': video_size_mb,
            'status': status['status'],
            'shot_count': self.results['shot_count'],
            'shots': self.results['shots'],
            'timings': dict(self.timings),
            'total_time': total_time
        }


def print_video_header(video_path: str, system: str):
    """Print test header."""
    print(f"\n{'='*70}")
    print(f"Testing: {Path(video_path).name} on {system}")
    print(f"{'='*70}")
    video_size_mb = Path(video_path).stat().st_size / (1024 * 1024)
    print(f"Video size: {video_size_mb:.1f} MB")


def print_results_summary(result: dict):
    """Print results summary for a single test."""
    print(f"\n{'='*40}")
    print("RESULTS SUMMARY")
    print(f"{'='*40}")
    print(f"Status: {result['status']}")
    print(f"Shots detected: {result['shot_count']}")

    if result['shots']:
        print("\nShots:")
        for shot in result['shots']:
            shot_id = shot.get('id', shot.get('shot_number', '?'))
            print(f"  Shot {shot_id}: {shot['strike_time']:.2f}s "
                  f"(conf: {shot['confidence']:.2f}, "
                  f"audio: {shot.get('audio_confidence', 0):.2f}, "
                  f"visual: {shot.get('visual_confidence', 0):.2f})")

    print("\nTimings:")
    print(f"  Upload: {result['timings'].get('upload', 0):.2f}s")
    print(f"  Process total: {result['timings'].get('process_total', 0):.2f}s")
    if 'process_steps' in result['timings']:
        for step, time_val in result['timings']['process_steps'].items():
            print(f"    - {step}: {time_val:.2f}s")
    if 'export' in result['timings']:
        export_total = result['timings'].get('export', 0) + result['timings'].get('export_poll', 0)
        print(f"  Export: {export_total:.2f}s")
    print(f"  Total E2E: {result['total_time']:.2f}s")


def print_comparison(desktop_results: list, webapp_results: list):
    """Print side-by-side comparison."""
    print(f"\n{'='*70}")
    print("PERFORMANCE COMPARISON: DESKTOP vs WEBAPP")
    print(f"{'='*70}")

    # Per-video comparison
    desktop_by_video = {r['video']: r for r in desktop_results if 'error' not in r}
    webapp_by_video = {r['video']: r for r in webapp_results if 'error' not in r}

    all_videos = set(desktop_by_video.keys()) | set(webapp_by_video.keys())

    print("\n" + "-"*70)
    print(f"{'Video':<20} {'System':<10} {'Shots':<8} {'Upload':<10} {'Process':<12} {'Total':<10}")
    print("-"*70)

    for video in sorted(all_videos):
        if video in desktop_by_video:
            d = desktop_by_video[video]
            print(f"{video:<20} {'Desktop':<10} {d['shot_count']:<8} "
                  f"{d['timings'].get('upload', 0):.1f}s{'':<6} "
                  f"{d['timings'].get('process_total', 0):.1f}s{'':<8} "
                  f"{d['total_time']:.1f}s")
        if video in webapp_by_video:
            w = webapp_by_video[video]
            print(f"{'':<20} {'Webapp':<10} {w['shot_count']:<8} "
                  f"{w['timings'].get('upload', 0):.1f}s{'':<6} "
                  f"{w['timings'].get('process_total', 0):.1f}s{'':<8} "
                  f"{w['total_time']:.1f}s")
        print()

    # Aggregate comparison
    print("-"*70)
    print("AGGREGATE METRICS")
    print("-"*70)

    if desktop_results:
        successful_desktop = [r for r in desktop_results if 'error' not in r]
        if successful_desktop:
            avg_upload = sum(r['timings'].get('upload', 0) for r in successful_desktop) / len(successful_desktop)
            avg_process = sum(r['timings'].get('process_total', 0) for r in successful_desktop) / len(successful_desktop)
            avg_total = sum(r['total_time'] for r in successful_desktop) / len(successful_desktop)
            total_shots = sum(r['shot_count'] for r in successful_desktop)
            avg_confidence = sum(
                sum(s['confidence'] for s in r['shots']) / len(r['shots'])
                for r in successful_desktop if r['shots']
            ) / len([r for r in successful_desktop if r['shots']])

            print(f"\nDESKTOP ({len(successful_desktop)} videos):")
            print(f"  Total shots detected: {total_shots}")
            print(f"  Average confidence: {avg_confidence:.2%}")
            print(f"  Avg upload: {avg_upload:.1f}s")
            print(f"  Avg process: {avg_process:.1f}s")
            print(f"  Avg total E2E: {avg_total:.1f}s")

    if webapp_results:
        successful_webapp = [r for r in webapp_results if 'error' not in r]
        if successful_webapp:
            avg_upload = sum(r['timings'].get('upload', 0) for r in successful_webapp) / len(successful_webapp)
            avg_process = sum(r['timings'].get('process_total', 0) for r in successful_webapp) / len(successful_webapp)
            avg_total = sum(r['total_time'] for r in successful_webapp) / len(successful_webapp)
            total_shots = sum(r['shot_count'] for r in successful_webapp)
            avg_confidence = sum(
                sum(s['confidence'] for s in r['shots']) / len(r['shots'])
                for r in successful_webapp if r['shots']
            ) / len([r for r in successful_webapp if r['shots']])

            print(f"\nWEBAPP ({len(successful_webapp)} videos):")
            print(f"  Total shots detected: {total_shots}")
            print(f"  Average confidence: {avg_confidence:.2%}")
            print(f"  Avg upload: {avg_upload:.1f}s")
            print(f"  Avg process: {avg_process:.1f}s")
            print(f"  Avg total E2E: {avg_total:.1f}s")


def main():
    # Configuration
    test_videos_dir = Path("test-videos")
    output_dir = test_videos_dir / "performance_test_output"
    output_dir.mkdir(exist_ok=True)

    desktop_url = "http://localhost:8420"
    webapp_url = "https://golfclip-api.fly.dev"

    # Find test videos
    videos = sorted(test_videos_dir.glob("*.mov"))
    if not videos:
        print(f"No .mov files found in {test_videos_dir}")
        sys.exit(1)

    print(f"Found {len(videos)} test videos")
    for v in videos:
        size_mb = v.stat().st_size / (1024 * 1024)
        print(f"  - {v.name}: {size_mb:.1f} MB")

    # Check services
    print("\n" + "="*70)
    print("SERVICE HEALTH CHECKS")
    print("="*70)

    desktop_test = DesktopTest(desktop_url)
    desktop_healthy = desktop_test.health_check()
    print(f"Desktop ({desktop_url}): {'✓ healthy' if desktop_healthy else '✗ unavailable'}")

    webapp_test = WebappTest(webapp_url)
    webapp_healthy = webapp_test.health_check()
    print(f"Webapp ({webapp_url}): {'✓ healthy' if webapp_healthy else '✗ unavailable'}")

    desktop_results = []
    webapp_results = []

    # Test Desktop
    if desktop_healthy:
        print("\n" + "="*70)
        print("DESKTOP APP TESTS")
        print("="*70)

        for video in videos:
            test = DesktopTest(desktop_url)
            print_video_header(str(video), "Desktop")
            try:
                result = test.run_test(str(video), str(output_dir))
                print_results_summary(result)
                desktop_results.append(result)
            except Exception as e:
                print(f"\nERROR: {e}")
                desktop_results.append({'video': video.name, 'error': str(e)})
    else:
        print("\nSkipping desktop tests - service unavailable")

    # Test Webapp
    if webapp_healthy:
        print("\n" + "="*70)
        print("WEBAPP TESTS")
        print("="*70)

        # Webapp limit is configurable via GOLFCLIP_MAX_VIDEO_SIZE_MB (default 500MB)
        # We've set it to 1000MB for testing
        for video in videos:
            test = WebappTest(webapp_url)
            print_video_header(str(video), "Webapp")
            try:
                result = test.run_test(str(video))
                print_results_summary(result)
                webapp_results.append(result)
            except Exception as e:
                print(f"\nERROR: {e}")
                webapp_results.append({'video': video.name, 'error': str(e)})
    else:
        print("\nSkipping webapp tests - service unavailable")

    # Comparison
    print_comparison(desktop_results, webapp_results)

    # Save results
    all_results = {
        'timestamp': datetime.now().isoformat(),
        'desktop': {
            'url': desktop_url,
            'healthy': desktop_healthy,
            'results': desktop_results,
        },
        'webapp': {
            'url': webapp_url,
            'healthy': webapp_healthy,
            'results': webapp_results,
        }
    }

    results_file = output_dir / f"comparison_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(results_file, 'w') as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"\nResults saved to: {results_file}")


if __name__ == "__main__":
    main()

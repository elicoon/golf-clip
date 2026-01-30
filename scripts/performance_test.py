#!/usr/bin/env python3
"""Performance test script for GolfClip desktop backend."""

import requests
import time
import json
import sys
from pathlib import Path
from datetime import datetime


class PerformanceTest:
    def __init__(self, base_url: str = "http://localhost:8420"):
        self.base_url = base_url
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

    def upload_video(self, video_path: str) -> str:
        """Upload video and return path."""
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

        # Get shots
        with self.timer("get_shots"):
            response = requests.get(f"{self.base_url}/api/shots/{job_id}")
            response.raise_for_status()
            shots = response.json()  # Returns a list directly, not {"shots": [...]}

        self.results['job_id'] = job_id
        self.results['status'] = status['status']
        self.results['shots'] = shots  # shots is already a list
        self.results['shot_count'] = len(shots)

        return status

    def export_clips(self, job_id: str, video_path: str, output_dir: str) -> dict:
        """Export clips and track timing."""
        shots = self.results.get('shots', [])
        if not shots:
            print("  No shots to export")
            return {}

        # Build ClipBoundary objects from detected shots
        clips = [
            {
                "shot_id": shot['id'],
                "start_time": shot['clip_start'],
                "end_time": shot['clip_end'],
                "approved": True  # Auto-approve for testing
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
            print(f"  Export started directly")
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
        """Run full E2E test on a video."""
        print(f"\n{'='*60}")
        print(f"Testing: {Path(video_path).name}")
        print(f"{'='*60}")

        video_size_mb = Path(video_path).stat().st_size / (1024 * 1024)
        print(f"Video size: {video_size_mb:.1f} MB")

        # Upload
        print("\n[1/3] Upload")
        server_path = self.upload_video(video_path)

        # Process
        print("\n[2/3] Processing")
        status = self.process_video(server_path)

        # Export (if shots detected)
        print("\n[3/3] Export")
        job_id = self.results['job_id']
        export_status = self.export_clips(job_id, server_path, output_dir)

        # Summary
        print(f"\n{'='*60}")
        print("RESULTS SUMMARY")
        print(f"{'='*60}")
        print(f"Video: {Path(video_path).name}")
        print(f"Size: {video_size_mb:.1f} MB")
        print(f"Status: {status['status']}")
        print(f"Shots detected: {self.results['shot_count']}")

        if self.results['shots']:
            print("\nShots:")
            for shot in self.results['shots']:
                print(f"  Shot {shot['id']}: {shot['strike_time']:.2f}s "
                      f"(confidence: {shot['confidence']:.2f})")

        print("\nTimings:")
        print(f"  Upload: {self.timings.get('upload', 0):.2f}s")
        print(f"  Process total: {self.timings.get('process_total', 0):.2f}s")
        if 'process_steps' in self.timings:
            for step, time_val in self.timings['process_steps'].items():
                print(f"    - {step}: {time_val:.2f}s")
        print(f"  Export: {self.timings.get('export', 0):.2f}s")

        total_time = sum([
            self.timings.get('upload', 0),
            self.timings.get('process_total', 0),
            self.timings.get('export', 0)
        ])
        print(f"  Total E2E: {total_time:.2f}s")

        return {
            'video': Path(video_path).name,
            'size_mb': video_size_mb,
            'status': status['status'],
            'shot_count': self.results['shot_count'],
            'shots': self.results['shots'],
            'timings': dict(self.timings),
            'total_time': total_time
        }


def main():
    # Test videos
    test_videos_dir = Path("/Users/ecoon/Desktop/golf-clip test videos")
    output_dir = test_videos_dir / "performance_test_output"
    output_dir.mkdir(exist_ok=True)

    videos = sorted(test_videos_dir.glob("*.mov"))
    if not videos:
        print(f"No .mov files found in {test_videos_dir}")
        sys.exit(1)

    print(f"Found {len(videos)} test videos")

    all_results = []

    for video in videos:
        test = PerformanceTest()
        try:
            result = test.run_test(str(video), str(output_dir))
            all_results.append(result)
        except Exception as e:
            print(f"\nERROR testing {video.name}: {e}")
            all_results.append({
                'video': video.name,
                'error': str(e)
            })

    # Final summary
    print(f"\n{'='*60}")
    print("FINAL SUMMARY - DESKTOP APP PERFORMANCE")
    print(f"{'='*60}")
    print(f"Videos tested: {len(all_results)}")

    successful = [r for r in all_results if 'error' not in r]
    if successful:
        total_shots = sum(r['shot_count'] for r in successful)
        avg_time = sum(r['total_time'] for r in successful) / len(successful)
        print(f"Successful: {len(successful)}")
        print(f"Total shots detected: {total_shots}")
        print(f"Average E2E time: {avg_time:.2f}s")

        # Per-video summary
        print("\nPer-video results:")
        for r in successful:
            print(f"  {r['video']}: {r['shot_count']} shots, {r['total_time']:.2f}s E2E")

    # Save results to JSON
    results_file = output_dir / f"performance_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(results_file, 'w') as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"\nResults saved to: {results_file}")


if __name__ == "__main__":
    main()

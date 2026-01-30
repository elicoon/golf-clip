# GolfClip Performance Test Results
**Date:** January 25, 2026

## Executive Summary

Performance testing completed on the **desktop app** using 4 test videos (~750MB each). The **webapp was deployed** (700MB Docker image using multi-stage build), but webapp testing was limited due to Fly.io free tier constraints.

## Desktop App Performance

### Overview
- **Videos Tested:** 4
- **Total Shots Detected:** 15
- **Average E2E Time:** 33.5 seconds
- **Success Rate:** 100%

### Per-Video Results

| Video | Size (MB) | Shots | Upload | Process | Export | Total E2E |
|-------|-----------|-------|--------|---------|--------|-----------|
| IMG_0991.mov | 763.8 | 3 | 2.35s | 17.84s | 1.04s | 21.23s |
| IMG_0992.mov | 769.3 | 4 | 2.17s | 35.48s | 1.05s | 38.69s |
| IMG_0995.mov | 727.6 | 4 | 1.94s | 20.08s | 1.04s | 23.06s |
| IMG_0996.mov | 784.9 | 4 | 2.01s | 48.13s | 1.05s | 51.19s |

### Latency Breakdown (Averages)

| Step | Average Time | % of Total |
|------|--------------|------------|
| Upload | 2.1s | 6.3% |
| Processing | 30.4s | 90.7% |
| Export | 1.0s | 3.0% |
| **Total** | **33.5s** | **100%** |

Processing dominates the pipeline at ~91% of total time.

### Quality Metrics

#### Detection Confidence by Video

| Video | Shots | Avg Confidence | Avg Audio | Avg Visual |
|-------|-------|----------------|-----------|------------|
| IMG_0991.mov | 3 | 29.3% | 89.0% | 39.0% |
| IMG_0992.mov | 4 | 29.8% | 87.5% | 46.5% |
| IMG_0995.mov | 4 | 32.8% | 86.3% | 51.8% |
| IMG_0996.mov | 4 | 18.5% | 89.5% | 2.3% |

**Overall Average:**
- **Audio Confidence:** 88.1% (strong, consistent)
- **Visual Confidence:** 34.9% (highly variable)
- **Overall Confidence:** 27.6%

#### Shot Detection Details

**IMG_0991.mov (3 shots)**
| Shot | Strike Time | Audio Conf | Visual Conf | Overall |
|------|-------------|------------|-------------|---------|
| 1 | 18.25s | 86% | 42% | 30% |
| 2 | 60.28s | 88% | 16% | 22% |
| 3 | 111.46s | 93% | 59% | 36% |

**IMG_0992.mov (4 shots)**
| Shot | Strike Time | Audio Conf | Visual Conf | Overall |
|------|-------------|------------|-------------|---------|
| 1 | 0.07s | 84% | 50% | 32% |
| 2 | 52.87s | 89% | 50% | 33% |
| 3 | 87.06s | 86% | 85% | 43% |
| 4 | 115.84s | 91% | 1% | 11% |

**IMG_0995.mov (4 shots)**
| Shot | Strike Time | Audio Conf | Visual Conf | Overall |
|------|-------------|------------|-------------|---------|
| 1 | 0.07s | 87% | 59% | 35% |
| 2 | 29.57s | 86% | 19% | 23% |
| 3 | 65.64s | 89% | 67% | 38% |
| 4 | 106.51s | 83% | 62% | 35% |

**IMG_0996.mov (4 shots)**
| Shot | Strike Time | Audio Conf | Visual Conf | Overall |
|------|-------------|------------|-------------|---------|
| 1 | 13.18s | 89% | 7% | 20% |
| 2 | 51.84s | 89% | 2% | 18% |
| 3 | 86.83s | 91% | 0% | 18% |
| 4 | 114.78s | 89% | 0% | 18% |

### Key Observations

1. **Audio detection is reliable** - Consistently 83-93% confidence across all shots
2. **Visual detection is the weak link** - Ranges from 0% to 85%, with IMG_0996.mov showing particularly poor visual tracking (likely due to camera angle or lighting conditions)
3. **Processing time varies** - 17s to 48s depending on video complexity and shot count
4. **Upload is fast** - ~2s for ~750MB videos (local network)
5. **Export is efficient** - ~1s per video (async background processing)

## Webapp Deployment Status

### Deployment: SUCCESS

The multi-stage Docker build solved the image size problem:

| Metric | Before | After |
|--------|--------|-------|
| Image size | >8GB (blocked) | **700 MB** |
| Deployment | Failed | **Success** |

**Live URL:** https://golfclip-api.fly.dev

### Infrastructure Provisioned

- **Fly.io App:** `golfclip-api` (region: sjc)
- **Fly Postgres:** `golfclip-db` attached to app
- **Cloudflare R2:** Bucket configured with credentials
- **VM:** 2 shared CPUs, 2GB RAM

### Webapp Testing: LIMITED

Webapp performance testing was limited by Fly.io free tier constraints:

1. **Database Auto-Stop:** Postgres stops after idle period, causing app startup failures
2. **Memory Constraints:** 2GB RAM insufficient for 750MB+ file uploads
3. **Upload Timeouts:** Large files (750MB) cause 502 Bad Gateway errors

#### Attempted Uploads

| Video | Size | Upload Time | Result |
|-------|------|-------------|--------|
| IMG_0991.mov | 764 MB | 116s | 500 Error |
| IMG_0992.mov | 769 MB | 47s | 502 Error |
| IMG_0995.mov | 728 MB | 53s | 502 Error |
| IMG_0996.mov | 785 MB | 36s | 502 Error |

### Recommendations for Webapp Testing

To complete webapp performance testing:

1. **Upgrade Fly.io resources:**
   - Dedicated CPU (not shared)
   - 4GB+ RAM
   - Keep database running (set `min_machines_running = 1`)

2. **Use smaller test videos:**
   - Create trimmed versions under 500MB
   - Test with shorter golf clips

3. **Optimize upload handling:**
   - Implement chunked uploads
   - Stream directly to R2 instead of buffering in memory

## Comparison Summary

### Desktop vs Webapp (Theoretical)

| Metric | Desktop | Webapp (Expected) |
|--------|---------|-------------------|
| Upload | ~2s (local) | 30-120s (network) |
| Processing | ~30s | ~30-60s (cloud CPU) |
| Export | ~1s | N/A (client-side) |
| **Total** | **~33s** | **~60-180s** |

The webapp is expected to be slower due to:
- Network latency for uploads (local → R2)
- Cloud VM processing (shared CPU vs local M-series)
- Video download from R2 before processing

### Quality Parity

Both systems use the **same detection pipeline** (`golfclip-detection` package), so shot detection quality should be **identical**:
- Same YOLO model (yolov8n.pt)
- Same audio analysis (librosa)
- Same confidence scoring

## Test Artifacts

- Desktop results JSON: `/Users/ecoon/Desktop/golf-clip test videos/performance_test_output/comparison_results_*.json`
- Exported clips: `shot_1.mp4` through `shot_4.mp4` (~65MB each)
- Test scripts:
  - `/Users/ecoon/golf-clip/scripts/performance_test.py` (desktop only)
  - `/Users/ecoon/golf-clip/scripts/compare_performance.py` (both systems)

## Conclusions

1. **Desktop app performance is good** - 33s average E2E for 750MB videos
2. **Detection quality is consistent** - Audio detection is strong (88%), visual needs improvement (35%)
3. **Webapp deployment succeeded** - Multi-stage Docker build reduced image from >8GB to 700MB
4. **Webapp testing blocked by free tier** - Need upgraded resources for large file testing
5. **Same ML pipeline** - Quality parity expected between systems

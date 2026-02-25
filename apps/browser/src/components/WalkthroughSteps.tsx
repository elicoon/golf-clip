export function WalkthroughSteps() {
  return (
    <div className="walkthrough-steps">
      <div className="walkthrough-step">
        <div className="walkthrough-number">1</div>
        <div className="walkthrough-illustration walkthrough-upload">
          <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect
              x="10"
              y="15"
              width="100"
              height="55"
              rx="6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              opacity="0.4"
            />
            <path d="M60 30 L60 55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path
              d="M50 40 L60 30 L70 40"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="42" y="58" width="36" height="8" rx="4" fill="currentColor" opacity="0.2" />
          </svg>
        </div>
        <h3>Upload Video</h3>
        <p>Drop your golf video or select a file</p>
      </div>

      <div className="walkthrough-step">
        <div className="walkthrough-number">2</div>
        <div className="walkthrough-illustration walkthrough-tracer">
          <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Video frame */}
            <rect
              x="10"
              y="10"
              width="100"
              height="60"
              rx="4"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.3"
            />
            {/* Golfer silhouette */}
            <circle cx="30" cy="45" r="4" fill="currentColor" opacity="0.3" />
            <path
              d="M30 49 L30 62"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.3"
              strokeLinecap="round"
            />
            {/* Trajectory arc */}
            <path
              d="M32 55 Q60 15 90 50"
              stroke="#4ade80"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            {/* Landing dot */}
            <circle cx="90" cy="50" r="3" fill="#4ade80" />
          </svg>
        </div>
        <h3>Mark Tracers</h3>
        <p>Click landing points and review shot tracers</p>
      </div>

      <div className="walkthrough-step">
        <div className="walkthrough-number">3</div>
        <div className="walkthrough-illustration walkthrough-export">
          <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* File icon */}
            <path
              d="M40 15 L75 15 L85 25 L85 65 L40 65 Z"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.4"
            />
            <path d="M75 15 L75 25 L85 25" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
            {/* MP4 text */}
            <text
              x="62"
              y="48"
              textAnchor="middle"
              fill="currentColor"
              fontSize="10"
              fontWeight="600"
              opacity="0.5"
            >
              .MP4
            </text>
            {/* Download arrow */}
            <path d="M62 55 L62 72" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" />
            <path
              d="M55 66 L62 72 L69 66"
              stroke="#4ade80"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h3>Export Clips</h3>
        <p>Download clips with tracers burned in</p>
      </div>
    </div>
  )
}

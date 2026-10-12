export default function ProgressRing({
  value,
  size = 20,
  stroke = 2.5,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={`${clamped}%`}
    >
      <title>{`${value}%`}</title>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-zinc-300/20 dark:stroke-zinc-600/30"
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--acc-500, #6366f1)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: 'stroke-dashoffset .4s ease' }}
      />
    </svg>
  );
}

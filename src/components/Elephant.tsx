export function Elephant({
  className = "",
  size = 34,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 34V23C7 12 14 7 25 7s17 7 17 16v12c0 7-10 7-10 0v-8M7 28v12h8V28m2-10c0-7 12-7 12 0v13c0 7-12 7-12 0Z"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="35" cy="19" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function Botanical({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 250"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M90 243c25-71 21-133 9-217M109 150C51 137 32 91 47 59c30 16 53 44 61 80M106 111c44-27 61-60 44-88-29 15-48 43-47 74M108 183c-50 8-81-17-90-50 36-3 68 10 88 39M102 219c48-5 77-33 76-66-39 4-66 24-73 53M100 60C80 39 79 22 91 9c16 12 22 29 12 50" />
        <path
          d="m48 64 58 75m43-111-44 69m-82 41 80 34m70-14-66 47"
          opacity=".5"
        />
      </g>
    </svg>
  );
}

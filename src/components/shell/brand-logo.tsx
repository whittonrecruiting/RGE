import Image from "next/image";

/** Mark-only logo (sidebar). Same artwork in both themes. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      src="/brand/RGE-mark-64.png"
      alt="Recruiter Growth Engine"
      width={size}
      height={size}
      priority
    />
  );
}

/** Wide header logo (phone top bar). Both variants render; CSS shows the one for the active theme. */
export function BrandHeader({ height = 28 }: { height?: number }) {
  const width = height * 5;
  return (
    <>
      <Image
        className="logo-dark"
        src="/brand/RGE-header-for-dark-backgrounds.png"
        alt="Recruiter Growth Engine"
        width={width}
        height={height}
        priority
      />
      <Image
        className="logo-light"
        src="/brand/RGE-header-for-light-backgrounds.png"
        alt="Recruiter Growth Engine"
        width={width}
        height={height}
        priority
      />
    </>
  );
}

import type { SVGProps } from 'react';

// Minimal inline stroke icons (no icon library). All are decorative: give the button or text its own label.
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props} />
  );
}

export const BrandMark = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="6" cy="18" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="18" cy="6" r="3" />
    <path d="M6 15.5C6 9 16 12 16 8.5" strokeDasharray="0.5 3.6" strokeWidth="2.2" />
  </Icon>
);
export const Check = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>);
export const Alert = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M12 8v5M12 16.5v.01" /><path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /></Icon>);
export const Info = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.01" /></Icon>);
export const Eye = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Icon>);
export const EyeOff = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M4 4l16 16M9.9 5.7A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.7M6.3 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>);
export const Plus = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>);
export const Compass = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></Icon>);
export const Camera = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.6h7L17 6h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" /><circle cx="12" cy="12.5" r="3.4" /></Icon>);
export const FileText = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h4.5" /></Icon>);
export const ArrowRight = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>);
export const Download = (p: SVGProps<SVGSVGElement>) => (<Icon {...p}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></Icon>);

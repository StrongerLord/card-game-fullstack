// Corona de victoria: el mismo trazo que la de la pantalla de fin (Dialogs), en un solo color.
// Toma currentColor, así el dorado (#ffd34d) lo pone el CSS de quien la use.
export const CrownIcon = ({ className = '', size = '1em', title }) => (
  <svg
    className={`gt-crown-icon ${className}`.trim()}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
  >
    {title && <title>{title}</title>}
    <path
      d="M22.766,4.566A1.994,1.994,0,0,0,20.586,5L18,7.586,13.414,3a2,2,0,0,0-2.828,0L6,7.586,3.414,5A2,2,0,0,0,0,6.414V17a5.006,5.006,0,0,0,5,5H19a5.006,5.006,0,0,0,5-5V6.414A2,2,0,0,0,22.766,4.566Z"
      fill="currentColor"
    />
  </svg>
);

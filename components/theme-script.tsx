/**
 * Applies the stored or system theme before first paint so there is no flash.
 * Kept as a raw inline script deliberately — a React effect runs too late.
 */
export function ThemeScript() {
  const script = `(function(){try{var s=localStorage.getItem('ccc-theme');var m=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=(s==='light'||s==='dark')?s:m;}catch(e){document.documentElement.dataset.theme='dark';}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

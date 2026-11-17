// The design system lives in plain CSS files under public/assets/css. They are
// linked (not bundled) so the cascade order of the static site is preserved
// exactly: section sheets first, global.css last. React hoists these <link>s
// into <head>, de-duplicates them and blocks paint until they load.

export type Sheet = 'account' | 'admin' | 'dashboard' | 'learn' | 'roadmaps' | 'workshops';

export function Styles({ sheets = [] }: { sheets?: Sheet[] }) {
  return (
    <>
      {sheets.map((name) => (
        <link key={name} rel="stylesheet" href={`/assets/css/${name}.css`} precedence="section" />
      ))}
      <link rel="stylesheet" href="/assets/css/global.css" precedence="theme" />
    </>
  );
}

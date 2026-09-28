/**
 * The Map204 mark.
 *
 * The PNG set, not the SVG. The vector version was inlined here rather than loaded
 * as an `<img>`, on the grounds that it would inherit `currentColor` and cost no
 * request -- but neither held: the colours were hard-coded `fill` attributes
 * precisely because a mark should not recolour with a theme, so there was nothing
 * to inherit, and an inlined 6KB of paths is not cheaper than one image the browser
 * caches across every screen that shows the mark.
 *
 * ## Which resolution
 *
 * A `srcset` from 1x to 4x rather than a single reference to the @4x file. The
 * intent is the largest resolution, and a srcset is how you get it: the browser
 * picks @4x on a high-density screen, @2x on an ordinary one, and the 21KB @4x is
 * never downloaded by somebody whose display could not have shown the difference.
 * Pointing every screen at @4x would technically also be "the biggest resolution"
 * and would waste 16KB on every visit from a laptop.
 *
 * `width`/`height` are set to the 4x pixel dimensions so the browser reserves the
 * right box before the image arrives. Without them the workspace screen reflows as
 * the logo lands, which is the one screen where a visible shift is least welcome.
 */
export function Map204Logo({
  className = '',
}: {
  className?: string
}) {
  return (
    <img
      src="/1x/Map204_logo2.png"
      srcSet={[
        '/1x/Map204_logo2.png 1x',
        '/2x/Map204_logo2@2x.png 2x',
        '/3x/Map204_logo2@3x.png 3x',
        '/4x/Map204_logo2@4x.png 4x',
      ].join(', ')}
      // 681x342 at 4x; the aspect ratio is what matters, and the browser divides.
      width={681}
      height={342}
      className={className}
      /*
       * Not `alt="Map204"`. The mark is the product's name, and it is the first
       * thing on the workspace screen -- so it is the page's name, which belongs in
       * the document title and in the landmark, not as an image description a screen
       * reader reads out on arrival. It is decorative with respect to this
       * document's content; the heading below it carries the meaning.
       */
      alt=""
      role="presentation"
      decoding="async"
    />
  )
}

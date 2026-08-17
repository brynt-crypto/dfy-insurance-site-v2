"use client";

import { useEffect, useRef, useState } from "react";
import { hero, site } from "@/lib/site";

/**
 * Scroll-scrubbed video hero.
 *
 * The section is tall (SCROLL_SCREENS worth of viewport height) and the inner
 * frame is sticky, so the video stays on screen while the page scrolls past it.
 * Scroll position through the section maps 1:1 onto the video's currentTime,
 * so the footage plays forward as you scroll down and backward as you scroll
 * up. When the section ends the frame unsticks and the page continues.
 *
 * The video is never played — it is seeked. Autoplay is therefore irrelevant,
 * which is what makes this work on iOS where autoplay is heavily restricted.
 */

/**
 * How many viewport-heights of scrolling the clip is spread across.
 *
 * This is the dial that controls how long the effect lasts. At 2 the 270
 * frames passed in roughly 6px of scroll each, so anyone flicking down missed
 * the whole thing. At 6 each frame gets about 20px, which is slow enough to
 * read as film rather than a flicker. Raise it to linger longer; note it also
 * increases how far a visitor scrolls before reaching the coverage cards.
 */
const SCROLL_SCREENS = 15;

/**
 * Fraction of the scroll over which the video plays. The remainder holds on
 * the final frame so the closing card and its CTA stay put for a beat instead
 * of flying past the moment the last frame lands.
 */
const VIDEO_END_AT = 0.88;

/**
 * The headline holds until TEXT_FADE_START, then fades out by TEXT_FADE_END.
 * Both are measured in video progress, not scroll progress, so they stay tied
 * to what is on screen no matter how SCROLL_SCREENS is tuned.
 */
const TEXT_FADE_START = 0.6;
const TEXT_FADE_END = 0.86;

/** GitHub Pages serves from a sub-path; raw media src has to include it. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Intrinsic size of the footage, and where object-position anchors it. */
const VIDEO_W = 1920;
const VIDEO_H = 1080;

/**
 * The clip ends on a branded card containing an orange button with no label on
 * it. The real "Get a Free Quote" CTA is drawn on top of it.
 *
 * The placeholder in the footage is not square to the frame: it is rotated
 * about half a degree and its centre sits ~18px left of centre (it spans
 * x616-1268, so centre 942 against the frame's 960). Copying those bounds
 * exactly reproduced the tilt and the off-centre look.
 *
 * So the overlay is instead centred on the true frame centre (960) and made
 * large enough to completely cover the crooked placeholder — half-width has to
 * clear 960-616=344, half-height 913-864=49. At 700x108 it covers with margin,
 * and because it is opaque it becomes the button the visitor actually sees.
 */
const VIDEO_BUTTON = { x: 610, y: 810, w: 700, h: 108 };

/** Scrub progress at which the video's button has finished animating in. */
const CTA_REVEAL_AT = 0.94;

/**
 * The video is shown whole (letterboxed) rather than cropped, so mapping a
 * rectangle from video space to screen space is just `contain` maths: one
 * uniform scale, centred, with bars on whichever axis has slack.
 *
 * Because the entire frame is always visible, the button can never be clipped
 * — which is what made the previous cover-based version need clamping and
 * per-viewport fallbacks.
 */
function mapVideoRect(containerW: number, containerH: number) {
  if (!containerW || !containerH) return null;

  const scale = Math.min(containerW / VIDEO_W, containerH / VIDEO_H);
  const displayedW = VIDEO_W * scale;
  const displayedH = VIDEO_H * scale;
  const offsetX = (containerW - displayedW) / 2;
  const offsetY = (containerH - displayedH) / 2;

  const rect = {
    left: offsetX + VIDEO_BUTTON.x * scale,
    top: offsetY + VIDEO_BUTTON.y * scale,
    width: VIDEO_BUTTON.w * scale,
    height: VIDEO_BUTTON.h * scale,
  };

  // Too small to carry a readable label; the page's other quote buttons cover
  // the action in that case.
  if (rect.width < 150 || rect.height < 30) return null;
  return rect;
}

export default function HeroScrub() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const targetTimeRef = useRef(0);
  const rafRef = useRef(0);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [canScrub, setCanScrub] = useState(false);
  const [ctaRect, setCtaRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  /**
   * The nav is sticky and opaque, so a frame pinned to top:0 slides underneath
   * it and loses its first ~80px — which is exactly where the closing card's
   * logo sits. Pin below the nav instead, and measure it rather than hard-code
   * it, since the bar is shorter on mobile.
   */
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const measure = () => setNavH(Math.round(header.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // Keep the overlaid CTA locked to the video's button through any resize.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const r = frame.getBoundingClientRect();
      setCtaRect(mapVideoRect(r.width, r.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Read the motion preference on the client only; the server cannot know it.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    const section = sectionRef.current;
    const video = videoRef.current;
    if (!section || !video) return;

    /**
     * Each scroll event only records a target time; this rAF loop does the
     * seeking. The video is encoded all-intra (every frame is a keyframe), so
     * a seek to any timestamp is near-instant and exact — which means we can
     * jump straight to the target instead of easing toward it. Easing was what
     * made the old version feel laggy: it always trailed the scrollbar.
     *
     * The `seeking` guard still matters. Assigning currentTime again while a
     * seek is in flight queues work faster than the decoder retires it.
     */
    const tick = () => {
      const target = targetTimeRef.current;
      if (!video.seeking && Math.abs(target - video.currentTime) > 0.004) {
        video.currentTime = target;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const onScroll = () => {
      const rect = section.getBoundingClientRect();
      // The sticky frame is shorter than the viewport (it sits below the nav),
      // so travel is measured against the frame, not the window. Using
      // innerHeight here would finish the scrub before the section ends.
      const frameH = frameRef.current?.getBoundingClientRect().height ?? window.innerHeight;
      const stickyTop = frameRef.current
        ? parseFloat(getComputedStyle(frameRef.current).top) || 0
        : 0;
      const scrollable = rect.height - frameH;
      if (scrollable <= 0) return;

      // 0 when the frame reaches its pinned position, 1 when the section ends.
      const p = Math.min(1, Math.max(0, (stickyTop - rect.top) / scrollable));
      setProgress(p);

      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        // Stop a hair short of the end: seeking to exactly duration can park
        // some browsers on a blank frame.
        // The clip finishes at VIDEO_END_AT; scroll past that holds the last
        // frame, keeping the closing card and its CTA on screen for a beat.
        const vp = Math.min(1, p / VIDEO_END_AT);
        targetTimeRef.current = Math.min(vp * duration, duration - 0.05);
      }
    };

    const start = () => {
      setCanScrub(true);
      onScroll();
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };

    if (video.readyState >= 1) start();
    else video.addEventListener("loadedmetadata", start, { once: true });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      video.removeEventListener("loadedmetadata", start);
    };
  }, [reduceMotion]);

  /**
   * Scroll progress runs 0..1 across the whole section; the video only plays
   * across the first VIDEO_END_AT of it. Everything tied to what's on screen
   * keys off videoProgress so the timings hold if SCROLL_SCREENS is retuned.
   */
  const videoProgress = Math.min(1, progress / VIDEO_END_AT);

  // Headline holds at full strength, then fades as the scrub completes.
  const textOpacity = reduceMotion
    ? 1
    : videoProgress < TEXT_FADE_START
      ? 1
      : Math.max(
          0,
          1 -
            (videoProgress - TEXT_FADE_START) /
              (TEXT_FADE_END - TEXT_FADE_START),
        );

  // Darkening is only needed while the headline is over the footage.
  const scrimOpacity =
    reduceMotion || videoProgress < TEXT_FADE_END
      ? 1
      : Math.max(
          0.12,
          1 - ((videoProgress - TEXT_FADE_END) / (1 - TEXT_FADE_END)) * 0.88,
        );

  // The aligned CTA appears once the video's own button has animated in.
  const ctaOpacity =
    reduceMotion || videoProgress < CTA_REVEAL_AT
      ? 0
      : Math.min(1, (videoProgress - CTA_REVEAL_AT) / (1 - CTA_REVEAL_AT));

  return (
    <section
      id="top"
      ref={sectionRef}
      className="relative"
      style={{
        // With reduced motion the section collapses to a single screen and
        // simply shows the poster frame — no tall scroll region, no scrubbing.
        height: reduceMotion ? "auto" : `${SCROLL_SCREENS * 100}vh`,
      }}
    >
      <div
        ref={frameRef}
        className={`${
          reduceMotion ? "relative" : "sticky"
        } flex min-h-[520px] items-center overflow-hidden bg-[var(--dfy-navy-900)]`}
        style={{
          top: reduceMotion ? undefined : navH,
          height: `calc(100svh - ${navH}px)`,
        }}
      >
        <video
          ref={videoRef}
          poster={`${BASE}/hero-poster.jpg`}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          // object-contain, not cover: the whole 16:9 frame is always visible,
          // so nothing is ever cut — no clipped foreheads, and the closing
          // card keeps the composition it was designed with. The trade is
          // letterbox bars, painted in the video's own navy. The mask feathers
          // the frame's edges into those bars so the seam is not a hard line.
          className="absolute inset-0 h-full w-full object-contain"
          style={{
            maskImage:
              "linear-gradient(90deg, transparent 0%, #000 2.5%, #000 97.5%, transparent 100%), linear-gradient(180deg, transparent 0%, #000 2.5%, #000 97.5%, transparent 100%)",
            maskComposite: "intersect",
            WebkitMaskImage:
              "linear-gradient(90deg, transparent 0%, #000 2.5%, #000 97.5%, transparent 100%), linear-gradient(180deg, transparent 0%, #000 2.5%, #000 97.5%, transparent 100%)",
            WebkitMaskComposite: "source-in",
          }}
        >
          {/* Scrubbing needs the whole file buffered, so the 1080p master is a
              12MB download. Phones get a 720p cut at less than half that; it
              sits behind a dark scrim, so the difference is not visible.
              Browsers pick a source at load time, not on resize — fine here,
              since a device rarely crosses this breakpoint mid-visit. */}
          <source
            src={`${BASE}/hero-720.mp4`}
            media="(max-width: 900px)"
            type="video/mp4"
          />
          <source src={`${BASE}/hero.mp4`} type="video/mp4" />
        </video>

        {/* Readability layer: a navy wash plus a stronger gradient on the text
            side, so white copy holds contrast over every frame of footage.
            Once the headline has gone, these lift so the closing branded card
            reads at full strength instead of through a dark film. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            opacity: scrimOpacity,
            background:
              "linear-gradient(90deg, rgba(8,21,39,0.92) 0%, rgba(8,21,39,0.72) 38%, rgba(8,21,39,0.35) 70%, rgba(8,21,39,0.28) 100%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            opacity: scrimOpacity,
            background:
              "linear-gradient(180deg, rgba(8,21,39,0.55) 0%, rgba(8,21,39,0) 30%, rgba(8,21,39,0) 62%, rgba(8,21,39,0.85) 100%)",
          }}
        />

        <div
          className="dfy-wrap relative w-full"
          style={{
            opacity: textOpacity,
            transform: reduceMotion
              ? undefined
              : `translateY(${(1 - textOpacity) * -24}px)`,
            willChange: "opacity, transform",
          }}
        >
          <div className="max-w-[46rem]">
            <p className="mb-5 inline-flex items-center gap-2 rounded-[var(--dfy-radius-pill)] border border-[rgba(217,164,65,0.45)] bg-[rgba(8,21,39,0.45)] px-4 py-2 text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-[var(--dfy-gold)] backdrop-blur-sm">
              {hero.eyebrow}
            </p>

            <h1 className="text-[length:var(--dfy-display-xl)] font-bold !text-white">
              {hero.headline}
            </h1>

            <p className="dfy-measure mt-6 text-[length:var(--dfy-body-l)] text-[var(--dfy-ink-on-navy)]">
              {hero.subhead}
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={hero.primaryCta.href} className="dfy-btn dfy-btn--primary">
                {hero.primaryCta.label}
              </a>
              <a href={hero.secondaryCta.href} className="dfy-btn dfy-btn--on-navy">
                <span className="hidden sm:inline">
                  {hero.secondaryCta.label} ·{" "}
                </span>
                <span className="sm:hidden">Call </span>
                {site.phone}
              </a>
            </div>

            <ul className="mt-10 flex flex-wrap gap-x-7 gap-y-3">
              {hero.trustPoints.map((point) => (
                <li
                  key={point}
                  className="flex items-center gap-2 text-[length:var(--dfy-small)] font-medium text-[var(--dfy-ink-on-navy-muted)]"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--dfy-gold)"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* The label for the video's blank end-card button. Sized a little
            larger than the button underneath so slight rounding never leaves
            an orange rim showing. If the geometry says the button is clipped
            at this viewport, ctaRect is null and this is skipped entirely —
            the page's other quote buttons still cover the action. */}
        {!reduceMotion && ctaRect && (
          <a
            href={hero.primaryCta.href}
            data-video-cta=""
            aria-hidden={ctaOpacity === 0}
            tabIndex={ctaOpacity === 0 ? -1 : 0}
            className="absolute z-10 flex items-center justify-center rounded-[var(--dfy-radius-pill)] bg-[var(--dfy-accent-bright)] font-semibold text-white no-underline shadow-[0_10px_30px_rgba(8,21,39,0.35)] transition-colors duration-200 hover:bg-[var(--dfy-accent)]"
            style={{
              left: ctaRect.left,
              top: ctaRect.top,
              width: ctaRect.width,
              height: ctaRect.height,
              fontSize: `clamp(0.95rem, ${ctaRect.height * 0.34}px, 1.35rem)`,
              opacity: ctaOpacity,
              pointerEvents: ctaOpacity > 0.5 ? "auto" : "none",
            }}
          >
            {hero.primaryCta.label}
          </a>
        )}

        {/* Scroll affordance — without it the sticky frame reads as a dead end. */}
        {!reduceMotion && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-7 flex justify-center"
            style={{ opacity: canScrub ? Math.max(0, 1 - progress * 4) : 0 }}
          >
            <span className="flex flex-col items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-white/70">
              Scroll
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-bounce"
              >
                <path d="M12 5v14" />
                <path d="m19 12-7 7-7-7" />
              </svg>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Logo from "@/components/Logo";
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

/**
 * The eyebrow pill and the H1 clear earlier than the rest, so the footage
 * underneath is not permanently covered — the CEO shot runs from roughly 47%
 * to 83% of the clip and was sitting behind the headline for its whole
 * duration. They hold at full strength through the opening, fade across
 * 20-45%, and are gone just before that shot begins.
 *
 * To undo: set HEADLINE_EARLY_FADE to false and the headline reverts to fading
 * with everything else on TEXT_FADE_START/END.
 */
const HEADLINE_EARLY_FADE = true;
const HEADLINE_FADE_START = 0.2;
const HEADLINE_FADE_END = 0.45;

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

/**
 * The clip's closing card is a large flat navy gradient, which is exactly what
 * video compression handles worst — it banded and looked pixelated. Since the
 * wordmark is already vector art and the CTA is already a real button, the
 * card is rebuilt natively instead: the video fades away and the section's own
 * background shows through, so it matches the page exactly and stays sharp at
 * any resolution.
 *
 * To undo: set HTML_ENDCARD to false and the video's own card plays through.
 */
const HTML_ENDCARD = true;

/** Where the clip cuts to its card (~9.6s of 11.35s), and when the swap ends. */
const ENDCARD_FADE_START = 0.845;
const ENDCARD_FADE_END = 0.93;

/**
 * The wordmark's box in the closing frame. Mapping the HTML logo onto the same
 * rectangle means it lands exactly where the video's logo was, so the swap
 * reads as one continuous card rather than a jump.
 */
const VIDEO_LOGO = { x: 560, y: 60, w: 1000, h: 230 };

/** Scrub progress at which the CTA has finished arriving. */
const CTA_REVEAL_AT = 0.9;

const clamp = (min: number, val: number, max: number) =>
  Math.min(max, Math.max(min, val));

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
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);

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
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setFrame({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
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

  // The eyebrow and H1 clear early to uncover the footage; see the constants.
  const headlineOpacity =
    reduceMotion || !HEADLINE_EARLY_FADE
      ? undefined // fall through to textOpacity below
      : videoProgress < HEADLINE_FADE_START
        ? 1
        : Math.max(
            0,
            1 -
              (videoProgress - HEADLINE_FADE_START) /
                (HEADLINE_FADE_END - HEADLINE_FADE_START),
          );

  // Everything else — subhead, buttons, trust points — holds, then fades.
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
  const scrimOpacityBase =
    reduceMotion || videoProgress < TEXT_FADE_END
      ? 1
      : Math.max(
          0.12,
          1 - ((videoProgress - TEXT_FADE_END) / (1 - TEXT_FADE_END)) * 0.88,
        );

  /**
   * Crossfade from the footage to the native card. Both sides move together so
   * there is never a frame where neither is showing.
   */
  const endCardOpacity =
    reduceMotion || !HTML_ENDCARD
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            (videoProgress - ENDCARD_FADE_START) /
              (ENDCARD_FADE_END - ENDCARD_FADE_START),
          ),
        );
  const videoOpacity = 1 - endCardOpacity;

  // Scrims only serve the footage; with the native card showing there is
  // nothing to darken, and any residue would tint the flat background.
  const scrimOpacity = scrimOpacityBase * (1 - endCardOpacity);

  /**
   * The closing card lays itself out against the frame, not against the
   * video's letterboxed box. Mapping it into that box made everything tiny on
   * a tall phone — the CTA came out 137x21, far under a usable tap target.
   * Nothing needs to line up with the footage any more, because by the time
   * this is visible the footage has faded out.
   */
  const card = frame
    ? {
        logoScale: clamp(0.8, frame.w / 950, 2.9),
        logoTop: frame.h * 0.14,
        ruleW: clamp(220, frame.w * 0.42, 640),
        ctaW: clamp(240, frame.w * 0.36, 520),
        ctaH: clamp(54, frame.h * 0.095, 84),
        ctaTop: frame.h * 0.7,
      }
    : null;

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
            opacity: videoOpacity,
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
            {/* Opacity only — the elements keep their box, so nothing below
                them shifts as they fade. */}
            <p
              className="mb-5 inline-flex items-center gap-2 rounded-[var(--dfy-radius-pill)] border border-[rgba(217,164,65,0.45)] bg-[rgba(8,21,39,0.45)] px-4 py-2 text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-[var(--dfy-gold)] backdrop-blur-sm"
              style={{ opacity: headlineOpacity }}
            >
              {hero.eyebrow}
            </p>

            <h1
              className="text-[length:var(--dfy-display-xl)] font-bold !text-white"
              style={{ opacity: headlineOpacity }}
            >
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

        {/* Native closing card. Replaces the clip's own card, which was a
            large flat gradient and banded badly under compression. The
            section's own background shows through instead, so it matches the
            page exactly and the wordmark stays vector-sharp at any size.
            Laid out against the frame, so it scales properly on phones. */}
        {HTML_ENDCARD && !reduceMotion && card && endCardOpacity > 0 && (
          <div
            className="pointer-events-none absolute inset-0 z-[5]"
            style={{ opacity: endCardOpacity }}
            aria-hidden={endCardOpacity < 0.5}
          >
            <div
              className="absolute inset-x-0 flex flex-col items-center"
              style={{ top: card.logoTop }}
            >
              {/* The wordmark is drawn at a fixed intrinsic size, so it is
                  scaled rather than re-typeset. */}
              <span
                style={{
                  transform: `scale(${card.logoScale.toFixed(3)})`,
                  transformOrigin: "center top",
                }}
              >
                <Logo tone="light" />
              </span>

              {/* The thin gold rule that sat under the wordmark in the artwork. */}
              <span
                style={{
                  marginTop: 34 * card.logoScale,
                  width: card.ruleW,
                  height: 1,
                  background:
                    "linear-gradient(90deg, transparent 0%, var(--dfy-gold) 50%, transparent 100%)",
                  opacity: 0.55,
                }}
              />
            </div>
          </div>
        )}

        {/* The closing card's call to action. It used to be positioned onto
            the blank orange button in the footage; now that the card is drawn
            natively there is nothing to trace, so it is sized for touch. */}
        {!reduceMotion && card && (
          <a
            href={hero.primaryCta.href}
            data-video-cta=""
            aria-hidden={ctaOpacity === 0}
            tabIndex={ctaOpacity === 0 ? -1 : 0}
            className="absolute left-1/2 z-10 flex -translate-x-1/2 items-center justify-center rounded-[var(--dfy-radius-pill)] bg-[var(--dfy-accent-bright)] font-semibold text-white no-underline shadow-[0_10px_30px_rgba(8,21,39,0.35)] transition-colors duration-200 hover:bg-[var(--dfy-accent)]"
            style={{
              top: card.ctaTop,
              width: card.ctaW,
              height: card.ctaH,
              fontSize: `clamp(1rem, ${(card.ctaH * 0.32).toFixed(1)}px, 1.35rem)`,
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

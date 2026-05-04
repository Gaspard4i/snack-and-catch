"use client";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TextureLoader, NearestFilter, type Texture } from "three";
import * as THREE from "three";
import { getBerryPivot } from "@/lib/snack/berry-pivots";
import { R3FErrorBoundary } from "@/components/R3FErrorBoundary";

/**
 * Faithful reproduction of cobblemon's `poke_snack.json` block model:
 *   - Single cube [1,0,1]→[15,7,15] = 14×7×14 MC units.
 *   - All six faces have `tintindex: 0` (tinted by seasoning colour).
 *   - `top` resolves to `poke_snack_top.png`, `bottom` to `poke_snack_bottom.png`,
 *     `side` to `poke_snack_side.png`. No overlay layer, unlike Poké Cake.
 *   - UVs: sides `[1,9,15,16]`, top/bottom `[1,1,15,15]`.
 *
 * A bait-berry lies flat on the top face (in-game a Poké Snack absorbs a
 * single seasoning — usually a berry from the `bait_seasoning` tag).
 */

const FLAVOUR_TINT: Record<string, string> = {
  SWEET: "#f8b3d7",
  SPICY: "#e85a3a",
  DRY: "#7fb3d5",
  BITTER: "#735a8a",
  SOUR: "#f4d35e",
};

/**
 * Pale food-colour palette used by Cobblemon's FoodColourComponent when
 * rendering a cooked item's tint (ARGB-averaged by the mod). Source:
 * `FoodColourComponent.kt`. Pastel-style, designed to look good as snack tints.
 */
const MC_COLOUR: Record<string, string> = {
  white: "#ffffff",
  orange: "#ffc3af",
  magenta: "#af8cff",
  light_blue: "#78c3eb",
  yellow: "#ffe1af",
  pink: "#e1a0ff",
  lime: "#cdffaf",
  gray: "#474f52",
  light_gray: "#9d9d97",
  cyan: "#87ebd7",
  purple: "#9191ff",
  blue: "#78a5ff",
  brown: "#835432",
  green: "#afffb4",
  red: "#ffafd7",
  black: "#000000",
};

export type BerryPlacement = {
  slug: string;
  itemId: string;
  colour: string | null;
  flavours: Record<string, number>;
  dominantFlavour: string | null;
  /** Bedrock model filename without extension, e.g. "oran_berry". */
  fruitModel?: string | null;
  /** Fruit texture filename without extension, e.g. "oran". */
  fruitTexture?: string | null;
  /** Up to 3 placements on the snack top face, in pixel units. */
  snackPositionings?: Array<{
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  }>;
};

const TEX = {
  top: "/textures/cobblemon/block/food/poke_snack_top.png",
  bottom: "/textures/cobblemon/block/food/poke_snack_bottom.png",
  side: "/textures/cobblemon/block/food/poke_snack_side.png",
};

function pixelate(t: Texture) {
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function setFaceUV(
  geo: THREE.BoxGeometry,
  faceIndex: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
) {
  const uv = geo.attributes.uv;
  const tl = [u0 / 16, 1 - v0 / 16];
  const tr = [u1 / 16, 1 - v0 / 16];
  const bl = [u0 / 16, 1 - v1 / 16];
  const br = [u1 / 16, 1 - v1 / 16];
  const base = faceIndex * 4;
  uv.setXY(base + 0, tl[0], tl[1]);
  uv.setXY(base + 1, tr[0], tr[1]);
  uv.setXY(base + 2, bl[0], bl[1]);
  uv.setXY(base + 3, br[0], br[1]);
  uv.needsUpdate = true;
}

function berryColourHex(b: BerryPlacement): string {
  if (b.colour) {
    const key = b.colour.toLowerCase();
    if (MC_COLOUR[key]) return MC_COLOUR[key];
  }
  if (b.dominantFlavour && FLAVOUR_TINT[b.dominantFlavour]) {
    return FLAVOUR_TINT[b.dominantFlavour];
  }
  return "#ffffff";
}

function computeSnackTint(berries: BerryPlacement[], fallback: string | null): string {
  const placed = berries.filter(Boolean);
  if (placed.length === 0) {
    return fallback ? FLAVOUR_TINT[fallback] ?? "#ffffff" : "#ffffff";
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const berry of placed) {
    const hex = berryColourHex(berry);
    const int = Number.parseInt(hex.replace("#", ""), 16);
    const rr = (int >> 16) & 0xff;
    const gg = (int >> 8) & 0xff;
    const bb = int & 0xff;
    const w = berry.dominantFlavour ? berry.flavours[berry.dominantFlavour] ?? 1 : 1;
    r += rr * w;
    g += gg * w;
    b += bb * w;
    total += w;
  }
  r = Math.round(r / total);
  g = Math.round(g / total);
  b = Math.round(b / total);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Renders a berry using its actual Cobblemon Bedrock `.geo.json` model and
 * fruit texture — faithful to PokeSnackBlockEntityRenderer.kt. Positions
 * and rotations come from `berry.snackPositionings[index]` which mirror the
 * upstream `pokeSnackPositionings` data. All coordinates in the model are in
 * Minecraft pixels (16 units per block), so we scale by 1/16.
 *
 * Falls back to two crossed textured planes when the 3D model or fruit
 * texture can't be resolved (e.g. legacy seasonings without geo).
 */
type BedrockDoc = import("@/lib/bedrock/geo").BedrockFile;

const geoCache = new Map<string, Promise<BedrockDoc>>();
async function loadGeo(fruitModel: string): Promise<BedrockDoc> {
  const url = `/textures/cobblemon/bedrock/berries/${fruitModel}.geo.json`;
  let p = geoCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`geo 404: ${fruitModel}`);
      // Manual parse so a non-JSON body (HTML 404 page from the dev
      // server) doesn't throw a SyntaxError upstream that the caller
      // can't tell from a real fetch failure.
      const text = await r.text();
      try {
        return JSON.parse(text) as BedrockDoc;
      } catch {
        throw new Error(`geo non-JSON: ${fruitModel}`);
      }
    });
    geoCache.set(url, p);
  }
  return p;
}

/**
 * Resolve the texture for an ingredient in a snack slot. Berries come with
 * their fruit sheet; vanilla bait seasonings (apple, golden_apple, glow_berries,
 * sweet_berries, etc.) fall back to their Minecraft item sprite.
 */
function resolveSeasoningTexture(berry: BerryPlacement): string {
  if (berry.fruitTexture) {
    return `/textures/cobblemon/berries/${berry.fruitTexture}.png`;
  }
  const [ns, raw] = berry.itemId.includes(":")
    ? berry.itemId.split(":", 2)
    : ["cobblemon", berry.itemId];
  if (ns === "minecraft") {
    // enchanted_golden_apple shares the golden_apple sprite in vanilla.
    const name =
      raw === "enchanted_golden_apple" ? "golden_apple" : raw;
    return `/textures/minecraft/item/${name}.png`;
  }
  if (raw.endsWith("_berry")) {
    return `/textures/cobblemon/item/berries/${raw}.png`;
  }
  return `/textures/cobblemon/item/${raw}.png`;
}

/**
 * DebugOverrides — optional extra transform applied on top of the
 * mod-derived placement. Used only by /debug/snack to tune the numbers
 * live. Everything defaults to zero so production renders are unchanged.
 */
export type BerryDebugOverrides = {
  offsetX?: number;    // world units, added to px
  offsetY?: number;    // world units, added to py
  offsetZ?: number;    // world units, added to pz
  rotOffsetX?: number; // degrees, added to rxDeg
  rotOffsetY?: number; // degrees, added to ryDeg
  rotOffsetZ?: number; // degrees, added to rzDeg
  /** Multiplier on the 1/16 base scale, Y axis only. Default +1. Set to
   * -1 to flip a single berry whose source model is upside down. */
  scaleFactorY?: number;
  /** Slug of the berry currently being tuned. When set, debug offsets
   * are applied ONLY to that berry — the others stay untouched. Lets
   * the operator dial in one berry at a time without disturbing the
   * already-correct ones. */
  targetSlug?: string | null;
};

function BerryOnTop({
  berry,
  index,
  totalCount,
  debug,
}: {
  berry: BerryPlacement;
  index: number;
  totalCount: number;
  debug?: BerryDebugOverrides;
}) {
  const texUrl = resolveSeasoningTexture(berry);
  // Wrap useLoader in an error boundary via a lazy fallback: Three's
  // useLoader throws synchronously on 404, which kills the whole Canvas.
  // We pre-check with a stateful loader to keep the canvas alive.
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    new TextureLoader().load(
      texUrl,
      (t) => {
        if (cancelled) return;
        pixelate(t);
        setTexture(t);
      },
      undefined,
      () => {
        /* 404 — leave texture null, component renders nothing */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [texUrl]);

  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!berry.fruitModel) return;
    loadGeo(berry.fruitModel)
      .then(async (doc) => {
        if (cancelled) return;
        const { boneToGeometry, firstBone } = await import("@/lib/bedrock/geo");
        const g = doc["minecraft:geometry"]?.[0];
        const bone = g ? firstBone(g) : null;
        if (!g || !bone) return;
        // Anchor each berry by its bbox CENTRE so its middle sits on the
        // origin. Combined with py = 7/16 below, this puts the berry's
        // centre exactly on the snack top face — i.e. the lower half is
        // sunk into the cake and the upper half pokes out.
        const pv = getBerryPivot(berry.slug);
        const custom =
          pv.cx != null || pv.cy != null || pv.cz != null
            ? { cx: pv.cx ?? 0, cy: pv.cy ?? 0, cz: pv.cz ?? 0 }
            : null;
        setGeometry(boneToGeometry(bone, g, "center", custom));
      })
      .catch(() => {
        /* model missing — fall back to plane below */
      });
    return () => {
      cancelled = true;
    };
  }, [berry.fruitModel, berry.slug]);

  const material = useMemo(
    () =>
      texture
        ? new THREE.MeshStandardMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
          })
        : null,
    [texture],
  );

  if (!material) return null;

  // Distribution on the snack top:
  //   1 berry  → centre, slight NE tilt.
  //   2 berries → ±OFFSET on X, bottoms pointing inward.
  //   3 berries → triangle, bottoms pointing inward.
  // Tilt sign: to make the BOTTOM lean toward the centre, the TOP must
  // lean OUTWARDS. A berry sitting at +X (east) needs to tip its top
  // toward +X → that's a negative rotation around Z (right-hand rule).
  // For a berry sitting at +Z, tip top toward +Z → positive rotation
  // around X.
  const OFFSET = 3 / 16; // 3 MC pixels from centre.
  const TILT_DEG = 18; // inward-bottom lean
  const SOLO_TILT = 6; // gentler tilt for the lonely centre berry
  let px = 0;
  let pz = 0;
  let rxDeg = 0;
  let rzDeg = 0;
  const ryDeg = 0;
  if (totalCount === 1) {
    // Slight NE lean: top toward NE, bottom toward SW.
    rxDeg = -SOLO_TILT; // top toward -Z (north)
    rzDeg = -SOLO_TILT; // top toward +X (east)
  } else if (totalCount === 2) {
    px = (index === 0 ? -1 : 1) * OFFSET;
    // index 0 at -X → top should lean -X → positive Z-rot.
    // index 1 at +X → top should lean +X → negative Z-rot.
    rzDeg = (index === 0 ? 1 : -1) * TILT_DEG;
  } else if (totalCount >= 3) {
    const angles = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3];
    const a = angles[Math.min(index, 2)];
    px = Math.cos(a) * OFFSET;
    pz = -Math.sin(a) * OFFSET;
    // To tip the BOTTOM toward centre, the TOP must point outward
    // (away from origin). The berry sits at world (cos·OFF, _, -sin·OFF),
    // so the outward direction is (+cos, 0, -sin).
    //   top moves +X (cos>0)  ↔ negative rotation around Z
    //   top moves -Z (sin>0)  ↔ negative rotation around X
    //     (right-hand rule: +rx rotates +Y toward +Z, we want -Z so -rx)
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    rxDeg = -sin * TILT_DEG;
    rzDeg = -cos * TILT_DEG;
  }
  const py = 7 / 16 + 0.5 / 16; // a touch above the top face, lower than before

  // Per-berry static pivot override + live debug overrides (debug only
  // affects the berry currently being tuned; see SnackMesh).
  const pivot = getBerryPivot(berry.slug);
  const isTarget =
    !debug?.targetSlug || debug.targetSlug === berry.slug;
  const d = isTarget ? (debug ?? {}) : {};
  const finalX = px + (pivot.dx ?? 0) + (d.offsetX ?? 0);
  const finalY = py + (pivot.dy ?? 0) + (d.offsetY ?? 0);
  const finalZ = pz + (pivot.dz ?? 0) + (d.offsetZ ?? 0);
  const rx = THREE.MathUtils.degToRad(rxDeg + (pivot.rx ?? 0) + (d.rotOffsetX ?? 0));
  const ry = THREE.MathUtils.degToRad(ryDeg + (pivot.ry ?? 0) + (d.rotOffsetY ?? 0));
  const rz = THREE.MathUtils.degToRad(rzDeg + (pivot.rz ?? 0) + (d.rotOffsetZ ?? 0));
  const baseScale = ((pivot.scale ?? 1)) / 16;
  const scaleY = ((d.scaleFactorY ?? 1) * (pivot.scale ?? 1)) / 16;

  if (geometry) {
    // Geometry is already bbox-centred in boneToGeometry, so we draw it
    // with positive scale on every axis. scaleFactorY in debug overrides
    // lets you flip a specific berry if its source model is upside-down.
    return (
      <group
        position={[finalX, finalY, finalZ]}
        rotation={[rx, ry, rz]}
      >
        <mesh
          geometry={geometry}
          material={material}
          scale={[baseScale, scaleY, baseScale]}
        />
      </group>
    );
  }

  // Vanilla bait items (apple, golden_apple, sweet_berries…) ship without
  // a Bedrock 3D model. They still tint the snack via computeSnackTint —
  // we deliberately render NOTHING on top so they don't compete visually
  // with the actual berry models.
  return null;
}

export function SnackMesh({
  berries,
  fallbackFlavour,
  potColour,
  wireframe = false,
  spin = true,
  berryDebug,
}: {
  berries: BerryPlacement[];
  fallbackFlavour: string | null;
  potColour: string | null;
  /** Debug-only: render the snack block as wireframe. */
  wireframe?: boolean;
  /** Idle rotation. Disable for the debug viewer so OrbitControls owns the scene. */
  spin?: boolean;
  /** Debug-only: extra offsets/rotations applied to every berry. */
  berryDebug?: BerryDebugOverrides;
}) {
  const group = useRef<THREE.Group>(null);

  const [topTex, bottomTex, sideTex] = useLoader(TextureLoader, [
    TEX.top,
    TEX.bottom,
    TEX.side,
  ]);
  [topTex, bottomTex, sideTex].forEach(pixelate);

  useFrame((_state, delta) => {
    if (spin && group.current) group.current.rotation.y += delta * 0.35;
  });

  // potColour overrides the berry-derived tint (UI convenience: see README).
  const tintHex = useMemo(() => {
    if (potColour && potColour.toLowerCase() !== "#c9b89e") return potColour;
    return computeSnackTint(berries, fallbackFlavour);
  }, [berries, fallbackFlavour, potColour]);
  const tint = useMemo(() => new THREE.Color(tintHex), [tintHex]);

  const W = 14 / 16;
  const H = 7 / 16;

  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(W, H, W);
    // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z
    setFaceUV(g, 0, 1, 9, 15, 16);
    setFaceUV(g, 1, 1, 9, 15, 16);
    setFaceUV(g, 2, 1, 1, 15, 15); // top
    setFaceUV(g, 3, 1, 1, 15, 15); // bottom
    setFaceUV(g, 4, 1, 9, 15, 16);
    setFaceUV(g, 5, 1, 9, 15, 16);
    return g;
  }, []);

  // Every face is tinted in the snack model.
  const mats = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ map: sideTex, color: tint, wireframe }),
      new THREE.MeshStandardMaterial({ map: sideTex, color: tint, wireframe }),
      new THREE.MeshStandardMaterial({ map: topTex, color: tint, wireframe }),
      new THREE.MeshStandardMaterial({ map: bottomTex, color: tint, wireframe }),
      new THREE.MeshStandardMaterial({ map: sideTex, color: tint, wireframe }),
      new THREE.MeshStandardMaterial({ map: sideTex, color: tint, wireframe }),
    ],
    [sideTex, topTex, bottomTex, tint, wireframe],
  );

  // Only count berries that have a 3D model when distributing on the top
  // face — vanilla items (no fruitModel) only contribute a tint and never
  // render on top, so they shouldn't shift the actual berries off-centre.
  const visibleBerries = berries.filter((b) => Boolean(b.fruitModel));

  return (
    <group ref={group}>
      <mesh position={[0, H / 2, 0]} geometry={geo} material={mats} />
      {visibleBerries.map((b, i) => (
        <BerryOnTop
          key={`${b.slug}-${i}`}
          berry={b}
          index={i}
          totalCount={visibleBerries.length}
          debug={berryDebug}
        />
      ))}
    </group>
  );
}

export function Snack3D({
  flavour,
  berries = [],
  potColour,
  size = 200,
  interactive = false,
}: {
  flavour?: string | null;
  berries?: BerryPlacement[];
  /**
   * When set, forces this hex colour as the snack tint, overriding the
   * flavour/berry-derived mix. Represents the "cooking pot colour" picker
   * in the UI — in the actual mod the pot colour is cosmetic only.
   */
  potColour?: string;
  size?: number;
  /**
   * Lets the user grab and rotate the snack with OrbitControls (drag,
   * scroll to zoom). Also disables the idle Y-spin so the camera the
   * user picked sticks. Off by default to keep the small thumbnail
   * preview behaving like a passive icon.
   */
  interactive?: boolean;
}) {
  /**
   * Gate the Canvas behind a post-mount flag. On client-side navigation
   * the wrapping <div> may render with a 0×0 layout for a frame before
   * Cache Components settles; R3F's ResizeObserver latches onto that
   * zero size and never recovers, giving a blank canvas until a hard
   * refresh.
   *
   * `canvasKey` is bumped to force a full remount when:
   *   - the WebGL context is lost (browser reclaims GPU memory after a
   *     background tab, after navigation, etc.)
   *   - the page becomes visible again after being hidden (some browsers
   *     dispose contexts when backgrounded and silently restore a blank
   *     framebuffer).
   */
  const [mounted, setMounted] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  // Bump key on every client-side navigation so a returning page (e.g.
  // /snack → /juice → /snack) gets a fresh Canvas instead of a stale
  // ResizeObserver that latched onto a 0x0 wrapper during the transition.
  useEffect(() => {
    setCanvasKey((k) => k + 1);
  }, [pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setCanvasKey((k) => k + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Watch the wrapper size: if it ever transitions from 0 to >0 (typical
  // Cache Components hydration race on returning navigations), force a
  // remount so R3F sizes the canvas correctly. Without this the canvas
  // stays 0x0 and renders nothing.
  useEffect(() => {
    const host = wrapperRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    let lastZero = host.clientWidth === 0 || host.clientHeight === 0;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        if (lastZero && w > 0 && h > 0) {
          lastZero = false;
          setCanvasKey((k) => k + 1);
        } else if (w === 0 || h === 0) {
          lastZero = true;
        }
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Attach a context-lost listener to the actual WebGL canvas the first
  // time it renders. If the GPU context is dropped we remount.
  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;
    const canvas = host.querySelector("canvas");
    if (!canvas) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      setCanvasKey((k) => k + 1);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [canvasKey]);

  return (
    <div
      ref={wrapperRef}
      className="rounded-lg border border-border bg-subtle overflow-hidden"
      style={{ width: size, height: size }}
    >
      {mounted && (
        <R3FErrorBoundary>
          <Canvas
            key={canvasKey}
            // Camera moved slightly higher (y 1.1 → 1.35) so the snack sits
            // lower in the framed preview with a bit more headroom on top.
            camera={{ position: [1.4, 1.35, 1.4], fov: 30 }}
            resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
            // Preserve drawing buffer = longer retention after a tab switch
            // on some mobile GPUs. Slight perf cost, invisible here.
            gl={{ preserveDrawingBuffer: true, powerPreference: "default" }}
          >
            <ambientLight intensity={0.8} />
            <directionalLight position={[3, 4, 2]} intensity={1.1} />
            <Suspense fallback={null}>
              <SnackMesh
                berries={berries}
                fallbackFlavour={flavour ?? null}
                potColour={potColour ?? null}
                spin
              />
            </Suspense>
            {interactive && (
              <OrbitControls
                enablePan={false}
                enableDamping
                dampingFactor={0.1}
                minDistance={0.6}
                maxDistance={4}
                target={[0, 0.2, 0]}
              />
            )}
          </Canvas>
        </R3FErrorBoundary>
      )}
    </div>
  );
}

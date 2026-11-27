import mazUrl from "../static/maz-5337.png";
import maz5551Url from "../static/maz-5551.png";
import maz54331Url from "../static/maz-54331.png";
import pazUrl from "../static/paz-3205.png";
import paz3206Url from "../static/paz-3206.png";
import uazUrl from "../static/uaz-patriot.png";
import uralUrl from "../static/ural-4320-10.png";
import ural5557Url from "../static/ural-5557-10.png";
import ural43206Url from "../static/ural-43206.png";

/**
 * Фото подбирается по названию модели. Регулярки терпимы к пробелам, дефисам
 * и регистру: "МАЗ-5337", "МАЗ 5337" и "маз5337" дадут одно и то же фото.
 *
 * ВАЖНО: порядок имеет значение — берётся первое совпадение.
 * Сначала идут конкретные модели, в конце — общие запасные варианты
 * для моделей без собственного фото (например, просто "МАЗ").
 */
const PHOTOS: { match: RegExp; src: string }[] = [
  // --- конкретные модели ---
  { match: /маз[\s-]*54331/i, src: maz54331Url },
  { match: /маз[\s-]*5551/i, src: maz5551Url },
  { match: /маз[\s-]*5337/i, src: mazUrl },

  { match: /паз[\s-]*3206/i, src: paz3206Url },
  { match: /паз[\s-]*3205/i, src: pazUrl },

  { match: /урал[\s-]*5557/i, src: ural5557Url },
  { match: /урал[\s-]*43206/i, src: ural43206Url },
  { match: /урал[\s-]*4320[\s-]*10/i, src: uralUrl },

  { match: /патриот|patriot/i, src: uazUrl },

  // --- запасные варианты по марке ---
  { match: /маз/i, src: mazUrl },
  { match: /паз/i, src: pazUrl },
  { match: /урал/i, src: uralUrl },
];

export function getVehiclePhoto(
  model?: string | null,
  make?: string | null
): string | undefined {
  const haystack = `${make ?? ""} ${model ?? ""}`;
  return PHOTOS.find((p) => p.match.test(haystack))?.src;
}
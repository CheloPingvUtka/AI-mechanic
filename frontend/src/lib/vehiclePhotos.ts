import mazUrl from "../static/maz-5337.png";
import uazUrl from "../static/uaz-patriot.png";
import uralUrl from "../static/ural-4320-10.png";
import pazUrl from "../static/paz-3205.png";

/**
 * Фото подбирается по названию модели. Регулярки терпимы к пробелам, дефисам
 * и регистру: "МАЗ-5337", "МАЗ 5337" и "маз5337" дадут одно и то же фото.
 * Чтобы добавить новую модель — положите файл в assets/vehicles и добавьте строку.
 */
const PHOTOS: { match: RegExp; src: string }[] = [
  { match: /маз[\s-]/i, src: mazUrl },
  { match: /патриот|/i, src: uazUrl },
  { match: /урал[\s-]/i, src: uralUrl },
  { match: /паз[\s-]/i, src: pazUrl },
];

export function getVehiclePhoto(
  model?: string | null,
  make?: string | null
): string | undefined {
  const haystack = `${make ?? ""} ${model ?? ""}`;
  return PHOTOS.find((p) => p.match.test(haystack))?.src;
}
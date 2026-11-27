import React, { CSSProperties } from "react";

/**
 * Российский гос. номер: легковой (тип 1) и спецтехника (тип 4).
 *
 * Использование:
 *   <LicensePlate vehicleId="P456AT178" />            // легковой
 *   <LicensePlate vehicleId="0133OX77" />             // спецтехника (определится сам)
 *   <LicensePlate vehicleId={data.vehicle_id} type="car" width={320} />
 */

export type PlateType = "auto" | "car" | "special";

export interface CarPlateData {
  type: "car";
  first: string;
  digits: string;
  last: string;
  region: string;
}

export interface SpecialPlateData {
  type: "special";
  digits: string;
  letters: string;
  region: string;
}

export type PlateData = CarPlateData | SpecialPlateData;

export interface LicensePlateProps {
  /** Номер строкой, латиницей или кириллицей: "P456AT178" */
  vehicleId: string;
  /** По умолчанию тип определяется по формату строки */
  type?: PlateType;
  /** Ширина знака в px (по умолчанию 320 для легкового, 200 для спецтехники) */
  width?: number;
  /** Показывать RUS и флаг */
  showFlag?: boolean;
}

// Латиница -> кириллица (разрешённые буквы гос. номеров)
const LATIN_TO_CYR: Record<string, string> = {
  A: "А", B: "В", E: "Е", K: "К", M: "М", H: "Н",
  O: "О", P: "Р", C: "С", T: "Т", Y: "У", X: "Х",
};
const CYR_LETTERS = "АВЕКМНОРСТУХ";
const L = `[${CYR_LETTERS}]`;

const CAR_RE = new RegExp(`^(${L})(\\d{3})(${L}{2})(\\d{2,3})$`);
const SPECIAL_RE = new RegExp(`^(\\d{4})(${L}{2})(\\d{2,3})$`);

const normalize = (raw: unknown): string =>
  String(raw ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .split("")
    .map((ch) => LATIN_TO_CYR[ch] ?? ch)
    .join("");

/** Разбор строки номера. Возвращает null, если формат не распознан. */
export function parseVehicleId(
  raw: string,
  type: PlateType = "auto"
): PlateData | null {
  const s = normalize(raw);

  if (type === "auto" || type === "car") {
    const m = s.match(CAR_RE);
    if (m) {
      return {
        type: "car",
        first: m[1],
        digits: m[2],
        last: m[3],
        region: m[4],
      };
    }
  }
  if (type === "auto" || type === "special") {
    const m = s.match(SPECIAL_RE);
    if (m) {
      return { type: "special", digits: m[1], letters: m[2], region: m[3] };
    }
  }
  return null;
}

const FONT =
  "'RoadNumbers','Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif";
const INK = "#111";

function Flag({ u }: { u: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        width: 26 * u,
        height: 17 * u,
        border: `${1 * u}px solid ${INK}`,
        boxSizing: "border-box",
      }}
    >
      <i style={{ flex: 1, background: "#fff" }} />
      <i style={{ flex: 1, background: "#0039a6" }} />
      <i style={{ flex: 1, background: "#d52b1e" }} />
    </span>
  );
}

interface CountryProps {
  u: number;
  showFlag: boolean;
  size?: number;
}

function Country({ u, showFlag, size = 24 }: CountryProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4 * u,
        fontSize: size * u,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: 0.5 * u,
      }}
    >
      RUS
      {showFlag && <Flag u={u} />}
    </span>
  );
}

function Screw({ u, style }: { u: number; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        width: 7 * u,
        height: 7 * u,
        borderRadius: "50%",
        background: INK,
        ...style,
      }}
    />
  );
}

interface PlateViewProps<T extends PlateData> {
  data: T;
  width: number;
  showFlag: boolean;
}

/* ---------- Легковой: 520 × 112 ---------- */
function CarPlate({ data, width, showFlag }: PlateViewProps<CarPlateData>) {
  const u = width / 520;
  const regionSize = data.region.length === 3 ? 62 : 78;

  return (
    <div
      role="img"
      aria-label={`Госномер ${data.first}${data.digits}${data.last} ${data.region}`}
      style={{
        position: "relative",
        display: "flex",
        width,
        height: 112 * u,
        boxSizing: "border-box",
        background: "#fff",
        color: INK,
        border: `${4 * u}px solid ${INK}`,
        borderRadius: 12 * u,
        fontFamily: FONT,
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      <Screw u={u} style={{ left: 9 * u, top: "50%", marginTop: -3.5 * u }} />

      {/* основная часть */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8 * u,
          paddingLeft: 12 * u,
          fontSize: 96 * u,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: 2 * u,
          whiteSpace: "nowrap",
        }}
      >
        <span>{data.first}</span>
        <span>{data.digits}</span>
        <span>{data.last}</span>
      </div>

      {/* регион */}
      <div
        style={{
          width: 134 * u,
          borderLeft: `${4 * u}px solid ${INK}`,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2 * u,
          position: "relative",
        }}
      >
        <span
          style={{
            fontSize: regionSize * u,
            fontWeight: 500,
            lineHeight: 0.95,
            letterSpacing: 1 * u,
          }}
        >
          {data.region}
        </span>
        <Country u={u} showFlag={showFlag} />
        <Screw u={u} style={{ right: 8 * u, top: "50%", marginTop: -3.5 * u }} />
      </div>
    </div>
  );
}

/* ---------- Спецтехника: 290 × 170 ---------- */
function SpecialPlate({
  data,
  width,
  showFlag,
}: PlateViewProps<SpecialPlateData>) {
  const u = width / 290;
  const regionSize = data.region.length === 3 ? 50 : 64;

  return (
    <div
      role="img"
      aria-label={`Госномер спецтехники ${data.digits}${data.letters} ${data.region}`}
      style={{
        position: "relative",
        width,
        height: 170 * u,
        boxSizing: "border-box",
        background: "#fff",
        color: INK,
        border: `${4 * u}px solid ${INK}`,
        borderRadius: 10 * u,
        fontFamily: FONT,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Screw u={u} style={{ left: 8 * u, top: 8 * u }} />
      <Screw u={u} style={{ right: 8 * u, top: 8 * u }} />

      {/* цифры */}
      <div
        style={{
          flex: "1 1 55%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 92 * u,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: 3 * u,
          paddingTop: 4 * u,
        }}
      >
        {data.digits}
      </div>

      {/* буквы + регион */}
      <div style={{ flex: "1 1 45%", display: "flex", alignItems: "stretch" }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 74 * u,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: 3 * u,
            paddingBottom: 4 * u,
          }}
        >
          {data.letters}
        </div>

        <div
          style={{
            width: 110 * u,
            borderTop: `${4 * u}px solid ${INK}`,
            borderLeft: `${4 * u}px solid ${INK}`,
            borderTopLeftRadius: 8 * u,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1 * u,
          }}
        >
          <span
            style={{
              fontSize: regionSize * u,
              fontWeight: 500,
              lineHeight: 0.95,
            }}
          >
            {data.region}
          </span>
          {showFlag && <Country u={u} showFlag={false} size={18} />}
        </div>
      </div>
    </div>
  );
}

export default function LicensePlate({
  vehicleId,
  type = "auto",
  width,
  showFlag = true,
}: LicensePlateProps) {
  const data = parseVehicleId(vehicleId, type);

  if (!data) {
    console.warn(`LicensePlate: не удалось разобрать номер "${vehicleId}"`);
    return null;
  }

  return data.type === "car" ? (
    <CarPlate data={data} width={width ?? 320} showFlag={showFlag} />
  ) : (
    <SpecialPlate data={data} width={width ?? 200} showFlag={showFlag} />
  );
}

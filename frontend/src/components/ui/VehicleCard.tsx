import { useLayoutEffect, useRef, useState } from "react";
import LicensePlate, { parseVehicleId } from "./LicensePlate";
import { getVehiclePhoto } from "../../lib/vehiclePhotos";
import "../../styles/VehicleCard.css";

/** Минимум полей, которые нужны карточке. Ваш тип Vehicle подойдёт как есть. */
export interface VehicleCardData {
  vehicle_id: string;
  garage_no?: string | null;
  make?: string | null;
  model?: string | null;
  vehicle_type?: string | null;
  engine_model?: string | null;
  fuel?: string | null;
}

export interface VehicleCardLabels {
  engine: string;
  garageNo: string;
  noPhoto: string;
}

export interface VehicleCardProps {
  vehicle: VehicleCardData;
  /** Своё фото. Если не задано — подбирается по модели (vehiclePhotos.ts) */
  photoSrc?: string;
  /** Подписи — сюда можно передать значения из t() */
  labels?: Partial<VehicleCardLabels>;
  className?: string;
}

const DEFAULT_LABELS: VehicleCardLabels = {
  engine: "Двигатель",
  garageNo: "Гаражный номер",
  noPhoto: "Фото недоступно",
};

/** Следит за шириной элемента, чтобы знак подстраивался под карточку. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width))
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

function PhotoPlaceholder({ label }: { label: string }) {
  return (
    <div className="vehicle-card__placeholder">
      <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
        <path
          d="M6 40V22a3 3 0 0 1 3-3h28v21M37 27h10l8 9v4M6 40h6m8 0h22m8 0h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="42" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="48" cy="42" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export default function VehicleCard({
  vehicle,
  photoSrc,
  labels,
  className,
}: VehicleCardProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const photo = photoSrc ?? getVehiclePhoto(vehicle.model, vehicle.make);
  const name = vehicle.model ?? vehicle.make ?? vehicle.vehicle_id;
  const alt = [vehicle.make, vehicle.model].filter(Boolean).join(" ") || name;

  const [plateSlot, slotWidth] = useElementWidth<HTMLDivElement>();
  const plate = parseVehicleId(vehicle.vehicle_id);
  const maxPlate = plate?.type === "special" ? 200 : 300;
  const plateWidth =
    slotWidth > 0 ? Math.min(maxPlate, Math.max(150, slotWidth)) : undefined;

  return (
    <article className={["vehicle-card", className].filter(Boolean).join(" ")}>
      <div className="vehicle-card__photo">
        {photo ? (
          <img
            src={photo}
            alt={alt}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <PhotoPlaceholder label={l.noPhoto} />
        )}
      </div>

      <div className="vehicle-card__plate" ref={plateSlot}>
        {plate ? (
          <LicensePlate vehicleId={vehicle.vehicle_id} width={plateWidth} />
        ) : (
          <span className="vehicle-card__plate-fallback">
            {vehicle.vehicle_id}
          </span>
        )}
      </div>

      <header className="vehicle-card__head">
        <h3 className="vehicle-card__title">{name}</h3>
        {vehicle.vehicle_type && (
          <p className="vehicle-card__subtitle">{vehicle.vehicle_type}</p>
        )}
      </header>

      <dl className="vehicle-card__specs">
        {(vehicle.engine_model || vehicle.fuel) && (
          <div className="vehicle-card__spec">
            <dt>{l.engine}</dt>
            <dd>
              {vehicle.engine_model}
              {vehicle.fuel && (
                <span className="vehicle-card__fuel">{vehicle.fuel}</span>
              )}
            </dd>
          </div>
        )}
        {vehicle.garage_no && (
          <div className="vehicle-card__spec">
            <dt>{l.garageNo}</dt>
            <dd>{vehicle.garage_no}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}
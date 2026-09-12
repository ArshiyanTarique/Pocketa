import * as React from 'react';
import { Crosshair, MapPin, Plus, Trash2, X } from 'lucide-react';
import { Button, Notice } from '../ui/primitives';
import { Field, TextInput } from '../ui/fields';
import { cn } from '../ui/cn';
import { distanceMetres, formatDistance, isValidLatLng, type LatLng, type Place } from '../core/geo';

/**
 * Choosing a point on the map, without a map.
 *
 * A tile-based map would need a network, an API key and a licence — none of
 * which suit an app whose premise is working offline. So a place is captured
 * the three ways people actually know one: where they are standing now, a spot
 * they have saved before, or coordinates pasted from somewhere else.
 *
 * The saved list is the important one. After a week of use the places a person
 * needs are the four or five they always travel between.
 */

export interface SavedPlace extends Place {
  id: string;
}

export function PlacePicker({
  value,
  onChange,
  label,
  saved,
  onSave,
  onForget,
  placeholder = 'Name this place',
}: {
  value: Place | null;
  onChange: (place: Place | null) => void;
  label: string;
  saved: SavedPlace[];
  onSave?: (place: Place) => void;
  onForget?: (id: string) => void;
  placeholder?: string;
}) {
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState(false);
  const [coords, setCoords] = React.useState('');
  const [name, setName] = React.useState('');

  function useCurrentLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('This browser cannot report your location. Enter the coordinates instead.');
      setManual(true);
      return;
    }
    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChange({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          name: name.trim() || 'Here',
        });
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was declined. Pick a saved place or enter coordinates.'
            : 'Your location could not be read just now. Try again, or enter it by hand.',
        );
        setManual(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function applyManual() {
    // Accepts "24.9204, 67.0942" — the shape you get from copying out of a maps app.
    const match = coords.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) {
      setError('Enter coordinates as latitude, longitude — for example 24.9204, 67.0942');
      return;
    }
    const candidate = { lat: Number(match[1]), lng: Number(match[2]) };
    if (!isValidLatLng(candidate)) {
      setError('Those coordinates are not on Earth. Check the order: latitude first.');
      return;
    }
    setError(null);
    onChange({ ...candidate, name: name.trim() || 'Point' });
    setManual(false);
    setCoords('');
  }

  return (
    <Field label={label}>
      <div className="space-y-2.5">
        {value ? (
          <div className="flex items-center gap-2.5 rounded-[11px] border border-accent bg-accent-soft px-3 py-2.5">
            <MapPin className="size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-medium text-accent">{value.name}</p>
              <p className="tnum text-[0.6875rem] text-ink-3">
                {value.lat.toFixed(4)}, {value.lng.toFixed(4)}
              </p>
            </div>
            {onSave && !saved.some((s) => distanceMetres(s, value) < 50) && (
              <button
                type="button"
                onClick={() => onSave(value)}
                className="rounded-[8px] px-2 py-1 text-xs font-medium text-accent hover:bg-surface"
              >
                Save
              </button>
            )}
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Clear ${label}`}
              className="flex size-8 items-center justify-center rounded-[8px] text-ink-3 hover:text-negative"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
              aria-label={`${label} name`}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={locating}
                icon={<Crosshair className="size-3.5" />}
                onClick={useCurrentLocation}
              >
                Use where I am
              </Button>
              <Button
                type="button"
                size="sm"
                variant={manual ? 'quiet' : 'secondary'}
                onClick={() => setManual((v) => !v)}
              >
                Enter coordinates
              </Button>
            </div>

            {manual && (
              <div className="flex gap-2">
                <TextInput
                  value={coords}
                  onChange={(e) => setCoords(e.target.value)}
                  placeholder="24.9204, 67.0942"
                  aria-label="Latitude and longitude"
                  className="tnum"
                />
                <Button type="button" variant="secondary" onClick={applyManual}>
                  Set
                </Button>
              </div>
            )}

            {saved.length > 0 && (
              <div>
                <p className="eyebrow mb-1.5">Saved places</p>
                <div className="flex flex-wrap gap-1.5">
                  {saved.map((place) => (
                    <span key={place.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onChange({ lat: place.lat, lng: place.lng, name: place.name })}
                        className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent"
                      >
                        {place.name}
                      </button>
                      {onForget && (
                        <button
                          type="button"
                          onClick={() => onForget(place.id)}
                          aria-label={`Forget ${place.name}`}
                          className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full border border-line bg-surface text-ink-4 hover:text-negative group-hover:flex"
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {error && <Notice tone="warn">{error}</Notice>}
      </div>
    </Field>
  );
}

/**
 * A route drawn from its own coordinates.
 *
 * Not a map — there is no basemap behind it — but it answers the question that
 * matters when you have just entered four points by hand: does this look like
 * the journey I make? A doubled-back leg or a stop in the wrong order is
 * obvious here and invisible in a list.
 */
export function RoutePreview({
  path,
  highlight,
  className,
  height = 160,
}: {
  path: readonly Place[];
  /** Extra points to mark, such as a proposed pickup and drop-off. */
  highlight?: Array<{ point: LatLng; label: string; tone: 'pickup' | 'dropoff' }>;
  className?: string;
  height?: number;
}) {
  if (path.length < 2) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-[--radius] border border-dashed border-line-strong text-xs text-ink-4',
          className,
        )}
        style={{ height }}
      >
        Add a start and a destination to see the route
      </div>
    );
  }

  const points = [...path, ...(highlight?.map((h) => h.point) ?? [])];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const pad = 0.12;
  const spanLat = Math.max(maxLat - minLat, 0.001);
  const spanLng = Math.max(maxLng - minLng, 0.001);
  const W = 300;
  const H = height;

  // Latitude increases northward but SVG y increases downward, so y is flipped.
  const x = (lng: number) => ((lng - minLng) / spanLng) * W * (1 - 2 * pad) + W * pad;
  const y = (lat: number) => H - (((lat - minLat) / spanLat) * H * (1 - 2 * pad) + H * pad);

  const line = path.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(' ');

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-[--radius] border border-line bg-surface-2"
        style={{ height: H }}
        role="img"
        aria-label={`Route from ${path[0].name} to ${path[path.length - 1].name}`}
      >
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {path.map((p, i) => (
          <g key={`${p.lat}-${p.lng}-${i}`}>
            <circle
              cx={x(p.lng)}
              cy={y(p.lat)}
              r={i === 0 || i === path.length - 1 ? 5 : 3.5}
              fill={i === 0 || i === path.length - 1 ? 'var(--accent)' : 'var(--surface)'}
              stroke="var(--accent)"
              strokeWidth="2"
            />
          </g>
        ))}
        {highlight?.map((h, i) => (
          <circle
            key={i}
            cx={x(h.point.lng)}
            cy={y(h.point.lat)}
            r="4.5"
            fill={h.tone === 'pickup' ? 'var(--positive)' : 'var(--warn)'}
            stroke="var(--surface)"
            strokeWidth="2"
          />
        ))}
      </svg>

      <div className="mt-2 flex items-center justify-between text-[0.6875rem] text-ink-3">
        <span className="truncate">{path[0].name}</span>
        <span className="truncate text-right">{path[path.length - 1].name}</span>
      </div>
    </div>
  );
}

/** Add or remove stops along a route. */
export function RouteStops({
  path,
  onChange,
  saved,
  onSave,
}: {
  path: Place[];
  onChange: (path: Place[]) => void;
  saved: SavedPlace[];
  onSave?: (place: Place) => void;
}) {
  const [adding, setAdding] = React.useState<Place | null>(null);

  return (
    <div className="space-y-2.5">
      <ol className="space-y-1.5">
        {path.map((place, i) => (
          <li
            key={`${place.name}-${i}`}
            className="flex items-center gap-2.5 rounded-[10px] border border-line px-3 py-2"
          >
            <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[0.6875rem] font-semibold text-ink-2">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-medium text-ink">{place.name}</p>
              {i > 0 && (
                <p className="tnum text-[0.625rem] text-ink-4">
                  {formatDistance(distanceMetres(path[i - 1], place))} from the last stop
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange(path.filter((_, j) => j !== i))}
              aria-label={`Remove ${place.name}`}
              className="flex size-8 items-center justify-center rounded-[8px] text-ink-4 hover:text-negative"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>

      <PlacePicker
        label={path.length === 0 ? 'Starting point' : path.length === 1 ? 'Destination' : 'Add a stop'}
        value={adding}
        onChange={setAdding}
        saved={saved}
        onSave={onSave}
      />

      {adding && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          icon={<Plus className="size-3.5" />}
          onClick={() => {
            onChange([...path, adding]);
            setAdding(null);
          }}
        >
          Add {adding.name} to the route
        </Button>
      )}
    </div>
  );
}

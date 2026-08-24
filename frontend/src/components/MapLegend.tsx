export type LegendSwatch = { kind: 'swatch'; color: string; label: string };
export type LegendGradient = {
  kind: 'gradient';
  title: string;
  stops: Array<{ color: string; at: string; label?: string }>;
};
export type LegendNote = { kind: 'note'; label: string; detail?: string };

export type LegendItem = LegendSwatch | LegendGradient | LegendNote;

type MapLegendProps = {
  title?: string;
  items: LegendItem[];
  position?: 'bottom-left' | 'bottom-right' | 'top-left';
  compact?: boolean;
  className?: string;
};

const positionClasses: Record<NonNullable<MapLegendProps['position']>, string> = {
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'top-left': 'top-4 left-4',
};

export default function MapLegend({
  title = 'Map legend',
  items,
  position = 'bottom-left',
  compact = false,
  className = '',
}: MapLegendProps) {
  return (
    <div
      className={`absolute z-[1000] pointer-events-none ${positionClasses[position]} ${className}`}
      aria-label={title}
    >
      <div
        className={`bg-white/95 backdrop-blur-sm border border-gray-200 shadow-lg rounded-lg pointer-events-auto ${
          compact ? 'p-2.5 max-w-[200px]' : 'p-3 max-w-[240px]'
        }`}
      >
        <div className={`font-semibold text-gray-800 ${compact ? 'text-[10px] mb-1.5' : 'text-xs mb-2'}`}>
          {title}
        </div>
        <div className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-2'}`}>
          {items.map((item, index) => {
            if (item.kind === 'swatch') {
              return (
                <div key={index} className="flex items-center gap-2">
                  <span
                    className={`rounded-full border border-white shadow-sm shrink-0 ${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'}`}
                    style={{ backgroundColor: item.color }}
                  />
                  <span className={`text-gray-600 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{item.label}</span>
                </div>
              );
            }
            if (item.kind === 'gradient') {
              return (
                <div key={index}>
                  <div className={`text-gray-700 font-medium ${compact ? 'text-[10px] mb-1' : 'text-[11px] mb-1'}`}>
                    {item.title}
                  </div>
                  <div
                    className="h-2.5 rounded-full border border-gray-200"
                    style={{
                      background: `linear-gradient(to right, ${item.stops.map((s) => `${s.color} ${s.at}`).join(', ')})`,
                    }}
                  />
                  <div className="flex justify-between mt-0.5">
                    {item.stops
                      .filter((s) => s.label)
                      .map((stop, stopIndex) => (
                        <span key={stopIndex} className="text-[9px] text-gray-500">
                          {stop.label}
                        </span>
                      ))}
                  </div>
                </div>
              );
            }
            return (
              <div key={index} className={`text-gray-600 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
                <span className="font-medium text-gray-700">{item.label}</span>
                {item.detail ? ` — ${item.detail}` : ''}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

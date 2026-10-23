/** The impact preview inside a confirmation: what the person loses (and
 * gains), one labelled list per kind; empty lists are left out. */
export function ImpactDetails({ groups }: { groups: { label: string; items: string[] }[] }) {
  const shown = groups.filter((g) => g.items.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-300">
      {shown.map((g) => (
        <div key={g.label}>
          <p className="font-medium">{g.label}</p>
          <ul className="ml-5 list-disc">
            {g.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

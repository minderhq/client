import { useI18n } from "../i18n";
import { modelFit, modelFitLabel, type CatalogModel } from "../lib/modelDefaults";
import { StatusBadge } from "./StatusBadge";

const TONE = { fits: "success", partial: "warn", too_large: "danger" } as const;

/** The selected model's size and GPU fit beside a model picker. Nothing when
 * the server doesn't know (an `unknown` verdict, an older server, a remote
 * model). */
export function ModelFitBadge({ model }: { model: CatalogModel | null | undefined }) {
  const tr = useI18n();
  const known = modelFit(model);
  const label = modelFitLabel(model, tr);
  if (!known || !label) return null;
  return (
    <StatusBadge
      icon={known.fit === "fits" ? "check" : "warning"}
      label={label}
      tone={TONE[known.fit]}
      srPrefix={tr.t("models.fitLabel")}
      className="mt-1"
    />
  );
}

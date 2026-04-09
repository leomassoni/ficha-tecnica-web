import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import Select from "react-select";

const API_URL = import.meta.env.VITE_API_URL || "https://ficha-tecnica-api.onrender.com";

type RecipeType = "prepreparo" | "drinks";
type RecipeOption = { label: string; key: string; status?: string };
type ExtraFields = {
  cmvFinal?: number | string | null;
  precoFinal?: number | string | null;
};
type FlavorProfile = {
  doce?: number | null;
  azedo?: number | null;
  amargo?: number | null;
  salgado?: number | null;
  umami?: number | null;
  drinkability?: number | null;
  picancia?: number | null;
};

type CalcResponse = {
  recipeType: RecipeType;
  recipeKey: string;
  volumeBase: number;
  volumeDesired: number | null;
  multiplier: number;
  custoTotalPorVolume: number;
  headerFound: boolean;
  ingredients: Array<{
    nome: string;
    quantEntrada: number | null;
    quantSaida: number | null;
    unidade: string;
    custoUnitario: number | null;
    custoReceita: number | null;
    custoPorPorcao: number | null;
  }>;
  modoPreparo: string;
  validade: string;
  storytelling?: string;
  status: string;
  extraFields?: ExtraFields;
  flavorProfile?: FlavorProfile | null;
};

type ExportScope = "current" | "all";
type ExportFormat = "pdf" | "xlsx";
type ExportRecipeData = CalcResponse & {
  recipeLabel: string;
  volumeDisplay: string;
  qtdDisplay: string;
};

const TAB_CONFIG: Record<
  RecipeType,
  {
    label: string;
    description: string;
    listEndpoint: string;
    calcEndpoint: (key: string, volume: string) => string;
  }
> = {
  prepreparo: {
    label: "Prepreparo",
    description:
      "Selecione uma receita e defina o volume ou a quantidade de receitas que serão produzidas.",
    listEndpoint: "/api/prepreparo/recipes",
    calcEndpoint: (key, volume) =>
      `/api/prepreparo/recipes/${encodeURIComponent(key)}/calc${
        volume.trim() ? `?volume=${encodeURIComponent(volume.trim())}` : ""
      }`,
  },
  drinks: {
    label: "Drinks",
    description:
      "Consulte ingredientes, custo, CMV, preço final e instruções de preparo dos drinks.",
    listEndpoint: "/api/drinks/recipes",
    calcEndpoint: (key, volume) =>
      `/api/drinks/recipes/${encodeURIComponent(key)}/calc${
        volume.trim() ? `?volume=${encodeURIComponent(volume.trim())}` : ""
      }`,
  },
};

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const mf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const TAB_KEYS = Object.keys(TAB_CONFIG) as RecipeType[];
const FLAVOR_FIELDS: Array<{ key: keyof FlavorProfile; label: string }> = [
  { key: "doce", label: "Doce" },
  { key: "azedo", label: "Azedo" },
  { key: "amargo", label: "Amargo" },
  { key: "salgado", label: "Salgado" },
  { key: "drinkability", label: "Drinkability" },
  { key: "picancia", label: "Picancia" },
];

function norm(s: string) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const QUOTED_RE = /["“]([^"”]+)["”]/g;

function parseUserNumberPtBr(s: string): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;

  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatPtBr(n: number, decimals = 2) {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function roundTo(n: number, decimals = 2) {
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

function formatModoPreparo(
  texto: string,
  ingredients: Array<{ nome: string; quantEntrada: number | null; unidade: string }>
) {
  const map = new Map<string, { quantEntrada: number | null; unidade: string; nome: string }>();

  for (const ingredient of ingredients) {
    map.set(norm(ingredient.nome), {
      quantEntrada: ingredient.quantEntrada,
      unidade: ingredient.unidade,
      nome: ingredient.nome,
    });
  }

  const replaced = (texto ?? "").replace(QUOTED_RE, (_match, ingRaw: string) => {
    const found = map.get(norm(ingRaw));
    if (!found) return ingRaw;

    const quantity = found.quantEntrada;
    const unit = (found.unidade || "").trim();
    if (quantity == null) return found.nome;

    return `${nf.format(quantity)}${unit ? ` ${unit}` : ""} de ${found.nome}`;
  });

  const protectedText = replaced.replace(/(\d)\.(\d)/g, "$1<dot>$2");

  return protectedText
    .split(".")
    .map((line) => line.replaceAll("<dot>", ".").trim())
    .filter(Boolean);
}

function formatMaybeCurrency(value: number | string | null | undefined) {
  if (typeof value === "number") return mf.format(value);
  return value ? String(value) : "-";
}

function formatMaybePercent(value: number | string | null | undefined) {
  if (typeof value === "number") {
    const normalized = value <= 1 ? value * 100 : value;
    return `${formatPtBr(normalized, 2)}%`;
  }

  return value ? String(value) : "-";
}

function clampFlavorLevel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function toSafeFilenamePart(value: string) {
  return norm(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatFlavorProfile(profile: FlavorProfile | null | undefined) {
  if (!profile) return [];

  return FLAVOR_FIELDS.map((field) => {
    const level = clampFlavorLevel(profile[field.key]);
    return `${field.label}: ${level}/5`;
  });
}

function buildExportFileName(type: RecipeType, scope: ExportScope, format: ExportFormat, key?: string) {
  const typeLabel = type === "drinks" ? "drinks" : "prepreparo";
  const scopeLabel = scope === "all" ? "todas-as-fichas" : toSafeFilenamePart(key || "ficha");
  return `ficha-tecnica-${typeLabel}-${scopeLabel}.${format}`;
}

function buildRecipeSummaryRows(recipe: ExportRecipeData) {
  const rows: Array<[string, string]> = [
    ["Tipo", recipe.recipeType === "drinks" ? "Drinks" : "Prepreparo"],
    ["Ficha", recipe.recipeLabel],
    ["Volume base", nf.format(recipe.volumeBase)],
    ["Quant. receitas desejado", recipe.qtdDisplay],
    ["Volume final desejado", recipe.volumeDisplay],
    ["Custo total por volume", mf.format(recipe.custoTotalPorVolume)],
  ];

  if (recipe.recipeType === "drinks") {
    rows.push(["CMV final", formatMaybePercent(recipe.extraFields?.cmvFinal)]);
    rows.push(["Preco final", formatMaybeCurrency(recipe.extraFields?.precoFinal)]);
  }

  if (recipe.recipeType !== "drinks" && recipe.validade) {
    rows.push(["Validade", recipe.validade]);
  }

  return rows;
}

function downloadWorkbook(workbook: import("xlsx").WorkBook, filename: string, XLSX: typeof import("xlsx")) {
  XLSX.writeFile(workbook, filename);
}

function exportRecipesToXlsx(
  XLSX: typeof import("xlsx"),
  type: RecipeType,
  scope: ExportScope,
  recipes: ExportRecipeData[],
  currentKey?: string
) {
  const workbook = XLSX.utils.book_new();

  const summaryRows = recipes.map((recipe) => ({
    Tipo: recipe.recipeType === "drinks" ? "Drinks" : "Prepreparo",
    Ficha: recipe.recipeLabel,
    "Volume base": recipe.volumeBase,
    "Quant. receitas desejado": recipe.qtdDisplay,
    "Volume final desejado": recipe.volumeDisplay,
    "Custo total por volume": recipe.custoTotalPorVolume,
    "CMV final": recipe.recipeType === "drinks" ? formatMaybePercent(recipe.extraFields?.cmvFinal) : "",
    "Preco final": recipe.recipeType === "drinks" ? formatMaybeCurrency(recipe.extraFields?.precoFinal) : "",
    Validade: recipe.recipeType !== "drinks" ? recipe.validade : "",
    "Modo de preparo": formatModoPreparo(recipe.modoPreparo, recipe.ingredients).join(" | "),
    Storytelling: recipe.storytelling ? formatModoPreparo(recipe.storytelling, recipe.ingredients).join(" | ") : "",
    "Perfil de sabor": formatFlavorProfile(recipe.flavorProfile).join(" | "),
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Resumo");

  const ingredientRows = recipes.flatMap((recipe) =>
    recipe.ingredients.map((ingredient) => ({
      Ficha: recipe.recipeLabel,
      Ingrediente: ingredient.nome,
      "Quant. entrada": ingredient.quantEntrada,
      "Quant. saida": ingredient.quantSaida,
      Unidade: ingredient.unidade,
      "Custo unitario": ingredient.custoUnitario,
      "Custo na receita": ingredient.custoReceita,
      "Custo por porcao": ingredient.custoPorPorcao,
    }))
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(ingredientRows.length ? ingredientRows : [{ Ficha: "", Ingrediente: "" }]),
    "Ingredientes"
  );

  downloadWorkbook(workbook, buildExportFileName(type, scope, "xlsx", currentKey), XLSX);
}

function exportRecipesToPdf(
  jsPDF: typeof import("jspdf").jsPDF,
  autoTable: typeof import("jspdf-autotable").default,
  type: RecipeType,
  scope: ExportScope,
  recipes: ExportRecipeData[],
  currentKey?: string
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pdfWithTables = doc as typeof doc & { lastAutoTable?: { finalY?: number } };

  recipes.forEach((recipe, index) => {
    if (index > 0) doc.addPage();

    doc.setFontSize(18);
    doc.text(recipe.recipeLabel, 40, 44);

    doc.setFontSize(11);
    doc.text(recipe.recipeType === "drinks" ? "Ficha tecnica de drink" : "Ficha tecnica de prepreparo", 40, 64);

    autoTable(doc, {
      startY: 78,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5 },
      head: [["Campo", "Valor"]],
      body: buildRecipeSummaryRows(recipe),
    });

    const ingredientsStartY = pdfWithTables.lastAutoTable?.finalY ?? 78;

    autoTable(doc, {
      startY: ingredientsStartY + 18,
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 4 },
      head: [[
        "Ingrediente",
        "Quant. entrada",
        "Quant. saida",
        "Unidade",
        "Custo unitario",
        "Custo na receita",
      ]],
      body: recipe.ingredients.map((ingredient) => [
        ingredient.nome,
        ingredient.quantEntrada == null ? "-" : nf.format(ingredient.quantEntrada),
        ingredient.quantSaida == null ? "-" : nf.format(ingredient.quantSaida),
        ingredient.unidade || "-",
        ingredient.custoUnitario == null ? "-" : mf.format(ingredient.custoUnitario),
        ingredient.custoReceita == null ? "-" : mf.format(ingredient.custoReceita),
      ]),
    });

    let cursorY = (pdfWithTables.lastAutoTable?.finalY ?? ingredientsStartY + 18) + 26;

    const sections: Array<{ title: string; lines: string[] }> = [];
    const prepLines = formatModoPreparo(recipe.modoPreparo, recipe.ingredients);
    if (prepLines.length) sections.push({ title: "Modo de preparo", lines: prepLines });

    if (recipe.recipeType === "drinks" && recipe.storytelling) {
      const storyLines = formatModoPreparo(recipe.storytelling, recipe.ingredients);
      if (storyLines.length) sections.push({ title: "Storytelling", lines: storyLines });
    }

    if (recipe.recipeType === "drinks") {
      const flavorLines = formatFlavorProfile(recipe.flavorProfile);
      if (flavorLines.length) sections.push({ title: "Perfil de sabor", lines: flavorLines });
    }

    sections.forEach((section) => {
      doc.setFontSize(12);
      doc.text(section.title, 40, cursorY);
      cursorY += 16;

      doc.setFontSize(10);
      section.lines.forEach((line) => {
        const wrapped = doc.splitTextToSize(`- ${line}`, 515);
        doc.text(wrapped, 40, cursorY);
        cursorY += wrapped.length * 13;
      });
      cursorY += 8;
    });
  });

  doc.save(buildExportFileName(type, scope, "pdf", currentKey));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<RecipeType>("prepreparo");
  const [recipesByType, setRecipesByType] = useState<Record<RecipeType, RecipeOption[]>>({
    prepreparo: [],
    drinks: [],
  });
  const [selectedKeyByType, setSelectedKeyByType] = useState<Record<RecipeType, string>>({
    prepreparo: "",
    drinks: "",
  });
  const [volumeByType, setVolumeByType] = useState<Record<RecipeType, string>>({
    prepreparo: "1000",
    drinks: "",
  });
  const [qtdByType, setQtdByType] = useState<Record<RecipeType, string>>({
    prepreparo: "",
    drinks: "1",
  });
  const [dataByType, setDataByType] = useState<Record<RecipeType, CalcResponse | null>>({
    prepreparo: null,
    drinks: null,
  });
  const [errorByType, setErrorByType] = useState<Record<RecipeType, string>>({
    prepreparo: "",
    drinks: "",
  });
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingCalc, setLoadingCalc] = useState(false);
  const [exporting, setExporting] = useState<string>("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const recipes = recipesByType[activeTab];
  const selectedKey = selectedKeyByType[activeTab];
  const volume = volumeByType[activeTab];
  const qtdReceitas = qtdByType[activeTab];
  const data = dataByType[activeTab];
  const error = errorByType[activeTab];
  const loading = loadingRecipes || loadingCalc;
  const volumeBase = data?.volumeBase ?? null;
  const effectiveVolume =
    activeTab === "drinks" && !volume && volumeBase ? formatPtBr(volumeBase, 2) : volume;
  const effectiveQtdReceitas =
    activeTab === "drinks" && !qtdReceitas && volumeBase ? "1" : qtdReceitas;

  useEffect(() => {
    if (activeTab !== "drinks") return;

    setSelectedKeyByType((current) => ({ ...current, drinks: "" }));
    setVolumeByType((current) => ({ ...current, drinks: "" }));
    setQtdByType((current) => ({ ...current, drinks: "1" }));
    setDataByType((current) => ({ ...current, drinks: null }));
    setErrorByType((current) => ({ ...current, drinks: "" }));
  }, [activeTab]);

  useEffect(() => {
    setExportMenuOpen(false);
  }, [activeTab, selectedKey]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingRecipes(true);
        setErrorByType((current) => ({ ...current, [activeTab]: "" }));

        const res = await fetch(`${API_URL}${TAB_CONFIG[activeTab].listEndpoint}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Erro ao carregar receitas");

        const nextRecipes = json.recipes ?? [];
        setRecipesByType((current) => ({ ...current, [activeTab]: nextRecipes }));
        setSelectedKeyByType((current) => {
          const currentKey = current[activeTab];
          const stillExists = nextRecipes.some((recipe: RecipeOption) => recipe.key === currentKey);

          if (activeTab === "drinks") {
            return {
              ...current,
              drinks: stillExists ? currentKey : "",
            };
          }

          return {
            ...current,
            [activeTab]: stillExists ? currentKey : nextRecipes[0]?.key ?? "",
          };
        });
      } catch (e: any) {
        setErrorByType((current) => ({ ...current, [activeTab]: e?.message ?? String(e) }));
      } finally {
        setLoadingRecipes(false);
      }
    })();
  }, [activeTab]);

  useEffect(() => {
    if (!selectedKey) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoadingCalc(true);
        setErrorByType((current) => ({ ...current, [activeTab]: "" }));

        const res = await fetch(`${API_URL}${TAB_CONFIG[activeTab].calcEndpoint(selectedKey, volume)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Erro ao calcular");

        setDataByType((current) => ({ ...current, [activeTab]: json }));
      } catch (e: any) {
        setDataByType((current) => ({ ...current, [activeTab]: null }));
        setErrorByType((current) => ({ ...current, [activeTab]: e?.message ?? String(e) }));
      } finally {
        setLoadingCalc(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [activeTab, selectedKey, volume]);

  useEffect(() => {
    if (activeTab !== "drinks" || !data || volumeByType.drinks) return;

    setVolumeByType((current) => ({
      ...current,
      drinks: formatPtBr(data.volumeBase, 2),
    }));
    setQtdByType((current) => ({
      ...current,
      drinks: current.drinks || "1",
    }));
  }, [activeTab, data, volumeByType.drinks]);

  function updateCurrentVolume(nextValue: string) {
    setVolumeByType((current) => ({ ...current, [activeTab]: nextValue }));
  }

  function updateCurrentQtd(nextValue: string) {
    setQtdByType((current) => ({ ...current, [activeTab]: nextValue }));
  }

  function handleVolumeChange(nextValue: string) {
    updateCurrentVolume(nextValue);

    const parsedVolume = parseUserNumberPtBr(nextValue);
    if (!volumeBase || volumeBase <= 0 || parsedVolume == null) {
      updateCurrentQtd("");
      return;
    }

    const quantity = roundTo(parsedVolume / volumeBase, 2);
    updateCurrentQtd(formatPtBr(quantity, 2));
  }

  function handleQtdReceitasChange(nextValue: string) {
    updateCurrentQtd(nextValue);

    const quantity = parseUserNumberPtBr(nextValue);
    if (!volumeBase || volumeBase <= 0 || quantity == null) return;

    const nextVolume = roundTo(volumeBase * quantity, 2);
    updateCurrentVolume(formatPtBr(nextVolume, 2));
  }

  async function fetchCalcData(recipeKey: string, volumeValue: string) {
    const res = await fetch(`${API_URL}${TAB_CONFIG[activeTab].calcEndpoint(recipeKey, volumeValue)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `Erro ao carregar ficha ${recipeKey}`);
    return json as CalcResponse;
  }

  async function collectRecipesForExport(scope: ExportScope) {
    if (scope === "current") {
      if (!selectedKey) throw new Error("Selecione uma ficha antes de exportar.");

      const currentData = data ?? (await fetchCalcData(selectedKey, volume));
      return [
        {
          ...currentData,
          recipeLabel: selectedLabel,
          volumeDisplay: effectiveVolume || formatPtBr(currentData.volumeBase, 2),
          qtdDisplay: effectiveQtdReceitas || "1",
        },
      ] satisfies ExportRecipeData[];
    }

    const exportedRecipes: ExportRecipeData[] = [];

    for (const recipe of recipes) {
      const calcData = await fetchCalcData(recipe.key, "");
      exportedRecipes.push({
        ...calcData,
        recipeLabel: recipe.label,
        volumeDisplay: formatPtBr(calcData.volumeBase, 2),
        qtdDisplay: "1",
      });
    }

    return exportedRecipes;
  }

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    try {
      setExporting(`${scope}-${format}`);
      setErrorByType((current) => ({ ...current, [activeTab]: "" }));

      const exportRecipes = await collectRecipesForExport(scope);
      if (!exportRecipes.length) {
        throw new Error("Nenhuma ficha disponivel para exportacao.");
      }

      if (format === "pdf") {
        const [{ jsPDF }, autoTableModule] = await Promise.all([
          import("jspdf"),
          import("jspdf-autotable"),
        ]);
        exportRecipesToPdf(jsPDF, autoTableModule.default, activeTab, scope, exportRecipes, selectedKey);
      } else {
        const XLSX = await import("xlsx");
        exportRecipesToXlsx(XLSX, activeTab, scope, exportRecipes, selectedKey);
      }
    } catch (e: any) {
      setErrorByType((current) => ({ ...current, [activeTab]: e?.message ?? String(e) }));
    } finally {
      setExporting("");
    }
  }

  const selectedLabel = useMemo(
    () => recipes.find((recipe) => recipe.key === selectedKey)?.label ?? selectedKey,
    [recipes, selectedKey]
  );

  const cmvFinal = data?.extraFields?.cmvFinal;
  const precoFinal = data?.extraFields?.precoFinal;

  return (
    <div className="page">
      <header className="header">
        <div className="tabs" role="tablist" aria-label="Tipos de ficha">
          {TAB_KEYS.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={`tabButton${tabKey === activeTab ? " isActive" : ""}`}
              onClick={() => setActiveTab(tabKey)}
            >
              {TAB_CONFIG[tabKey].label}
            </button>
          ))}
        </div>

        <h1>Ficha Técnica</h1>
        <p>{TAB_CONFIG[activeTab].description}</p>
      </header>

      <section className="controls">
        <div className="field">
          <label>{activeTab === "drinks" ? "Drink" : "Receita"}</label>

          <Select
            classNamePrefix="rs"
            placeholder="Digite para buscar…"
            isClearable={false}
            options={recipes.map((recipe) => ({ value: recipe.key, label: recipe.label }))}
            value={
              selectedKey
                ? {
                    value: selectedKey,
                    label: recipes.find((recipe) => recipe.key === selectedKey)?.label ?? selectedKey,
                  }
                : null
            }
            onChange={(option) =>
              {
                const nextKey = option?.value ?? "";
                setSelectedKeyByType((current) => ({
                  ...current,
                  [activeTab]: nextKey,
                }));

                if (activeTab === "drinks") {
                  setVolumeByType((current) => ({
                    ...current,
                    drinks: "",
                  }));
                  setQtdByType((current) => ({
                    ...current,
                    drinks: "1",
                  }));
                  setDataByType((current) => ({
                    ...current,
                    drinks: null,
                  }));
                  setErrorByType((current) => ({
                    ...current,
                    drinks: "",
                  }));
                }
              }
            }
          />
        </div>

        {activeTab === "drinks" ? (
          <>
            <div className="field">
                <label>Quant. receitas desejado</label>
              <input
                value={effectiveQtdReceitas}
                onChange={(e) => handleQtdReceitasChange(e.target.value)}
                placeholder="Ex.: 1"
                inputMode="decimal"
              />
            </div>

            <div className="field">
                <label>Volume final desejado (em gr ou ml)</label>
              <input
                value={effectiveVolume}
                onChange={(e) => handleVolumeChange(e.target.value)}
                placeholder="Ex.: 194"
                inputMode="decimal"
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Volume final desejado (em gr ou ml)</label>
              <input
                value={volume}
                onChange={(e) => handleVolumeChange(e.target.value)}
                placeholder="Ex.: 1000"
                inputMode="decimal"
              />
            </div>

            <div className="field">
              <label>Quant. receitas desejado</label>
              <input
                value={qtdReceitas}
                onChange={(e) => handleQtdReceitasChange(e.target.value)}
                placeholder="Ex.: 1,5"
                inputMode="decimal"
              />
            </div>
          </>
        )}
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Carregando…</div>}

      {data && !loading && (
        <>
          <section className="cards">
            <div className="card">
              <div className="k">{activeTab === "drinks" ? "Drink" : "Receita"}</div>
              <div className="v">{selectedLabel}</div>
            </div>

            <div className="card">
              <div className="k">Volume base</div>
              <div className="v">{nf.format(data.volumeBase)}</div>
            </div>

            <div className="card">
              <div className="k">Volume a ser produzido</div>
              <div className="v">
                {effectiveVolume
                  ? nf.format(parseUserNumberPtBr(effectiveVolume) ?? 0)
                  : nf.format(data.volumeBase)}
              </div>
            </div>

            <div className="card">
              <div className="k">Custo total por volume</div>
              <div className="v">{mf.format(data.custoTotalPorVolume)}</div>
            </div>

            {activeTab === "drinks" && (
              <>
                <div className="card">
                  <div className="k">CMV final</div>
                  <div className="v">{formatMaybePercent(cmvFinal)}</div>
                </div>

                <div className="card">
                  <div className="k">Preço final</div>
                  <div className="v">{formatMaybeCurrency(precoFinal)}</div>
                </div>
              </>
            )}
          </section>

          <section className="tableWrap">
            <h2>Ingredientes</h2>

            {!data.headerFound && (
              <div className="warn">
                Não detectei automaticamente a seção “ingredientes” no bloco dessa ficha.
              </div>
            )}

            <div className="tableScroll">
              <table>
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Quant. entrada</th>
                    <th>Quant. saída</th>
                    <th>Unidade</th>
                    <th>Custo unitário</th>
                    <th>Custo na receita</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ingredients.map((ingredient, idx) => (
                    <tr key={idx}>
                      <td>{ingredient.nome}</td>
                      <td>
                        {ingredient.quantEntrada == null ? "" : nf.format(ingredient.quantEntrada)}
                      </td>
                      <td>{ingredient.quantSaida == null ? "" : nf.format(ingredient.quantSaida)}</td>
                      <td>{ingredient.unidade || "-"}</td>
                      <td>
                        {ingredient.custoUnitario == null ? "" : mf.format(ingredient.custoUnitario)}
                      </td>
                      <td>
                        {ingredient.custoReceita == null ? "" : mf.format(ingredient.custoReceita)}
                      </td>
                    </tr>
                  ))}
                  {data.ingredients.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        Nenhum ingrediente encontrado para esta ficha.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="prepWrap">
            {activeTab === "drinks" && (
              <>
                <h2>Perfil de sabor</h2>
                <div className="flavorGrid">
                  {FLAVOR_FIELDS.map((field) => {
                    const level = clampFlavorLevel(data.flavorProfile?.[field.key]);

                    return (
                      <div key={field.key} className="flavorCard">
                        <div className="flavorLabel">{field.label}</div>
                        <div className="flavorScale" aria-label={`${field.label}: ${level} de 5`}>
                          {[0, 1, 2, 3, 4].map((step) => (
                            <span
                              key={step}
                              className={`flavorDot${step < level ? " isActive" : ""}`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <h2>Modo de preparo</h2>
            {data.modoPreparo ? (
              <ol className="prepList">
                {formatModoPreparo(
                  data.modoPreparo,
                  data.ingredients.map((ingredient) => ({
                    nome: ingredient.nome,
                    quantEntrada: ingredient.quantEntrada,
                    unidade: ingredient.unidade,
                  }))
                ).map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ol>
            ) : (
              <div className="muted">Sem modo de preparo cadastrado.</div>
            )}
          </section>

          {activeTab !== "drinks" && (
            <section className="validWrap">
              <h2>Validade</h2>
              <div className="validBox">{data.validade || "Sem validade cadastrada."}</div>
            </section>
          )}

          {activeTab === "drinks" && (
            <section className="prepWrap">
              <h2>Storytelling</h2>
              {data.storytelling ? (
                <ol className="prepList">
                  {formatModoPreparo(
                    data.storytelling,
                    data.ingredients.map((ingredient) => ({
                      nome: ingredient.nome,
                      quantEntrada: ingredient.quantEntrada,
                      unidade: ingredient.unidade,
                    }))
                  ).map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ol>
              ) : (
                <div className="muted">Sem storytelling cadastrado.</div>
              )}
            </section>
          )}
        </>
      )}

      <section className="exportBar">
        <div className="exportGroup">
          <span className="exportLabel">Exportacao</span>
          <button
            type="button"
            className="exportButton"
            disabled={(!selectedKey && !recipes.length) || !!exporting}
            onClick={() => setExportMenuOpen((current) => !current)}
          >
            {exporting ? "Gerando arquivo..." : exportMenuOpen ? "Fechar exportacao" : "Exportar"}
          </button>

          {exportMenuOpen && (
            <div className="exportChoices">
              <button
                type="button"
                className="exportChoiceButton"
                disabled={!selectedKey || !!exporting}
                onClick={() => handleExport("current", "pdf")}
              >
                Ficha exibida em PDF
              </button>
              <button
                type="button"
                className="exportChoiceButton"
                disabled={!selectedKey || !!exporting}
                onClick={() => handleExport("current", "xlsx")}
              >
                Ficha exibida em XLSX
              </button>
              <button
                type="button"
                className="exportChoiceButton"
                disabled={!recipes.length || !!exporting}
                onClick={() => handleExport("all", "pdf")}
              >
                Todas as fichas em PDF
              </button>
              <button
                type="button"
                className="exportChoiceButton"
                disabled={!recipes.length || !!exporting}
                onClick={() => handleExport("all", "xlsx")}
              >
                Todas as fichas em XLSX
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import Select from "react-select";

const API_URL = import.meta.env.VITE_API_URL || "https://ficha-tecnica-api.onrender.com";

type RecipeOption = { label: string; key: string };

type CalcResponse = {
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
};

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const mf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function norm(s: string) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// aceita aspas "..." e aspas “...”
const QUOTED_RE = /["“]([^"”]+)["”]/g;

function formatModoPreparo(
  texto: string,
  ingredients: Array<{ nome: string; quantEntrada: number | null; unidade: string }>
) {
  const map = new Map<string, { quantEntrada: number | null; unidade: string; nome: string }>();

  for (const it of ingredients) {
    map.set(norm(it.nome), { quantEntrada: it.quantEntrada, unidade: it.unidade, nome: it.nome });
  }

  // 1) substitui trechos entre aspas
  const replaced = (texto ?? "").replace(QUOTED_RE, (_m, ingRaw: string) => {
    const key = norm(ingRaw);
    const found = map.get(key);

    // Se não achou no mapa: remove aspas e mantém o texto como está
    if (!found) return ingRaw;

    const q = found.quantEntrada;
    const u = (found.unidade || "").trim();

    // Se não tiver número, só remove aspas e exibe nome
    if (q == null) return found.nome;

    return `de ${nf.format(q)}${u ? ` ${u}` : ""} ${found.nome}`;
  });

  // 2) quebra em passos por "."
  return replaced
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function App() {
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [volume, setVolume] = useState<string>("1000");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string>("");

  const debounceRef = useRef<number | null>(null);

  // carrega lista (dropdown)
  useEffect(() => {
    (async () => {
      try {
        setError("");
        const res = await fetch(`${API_URL}/api/recipes`);
        const json = await res.json();
        setRecipes(json.recipes ?? []);
        const first = json.recipes?.[0]?.key ?? "";
        setSelectedKey(first);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
  }, []);

  // recalcula quando muda receita ou volume
  useEffect(() => {
    if (!selectedKey) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError("");

        const q = volume.trim() ? `?volume=${encodeURIComponent(volume.trim())}` : "";
        const res = await fetch(`${API_URL}/api/recipes/${encodeURIComponent(selectedKey)}/calc${q}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Erro ao calcular");

        setData(json);
      } catch (e: any) {
        setData(null);
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [selectedKey, volume]);

  const selectedLabel = useMemo(
    () => recipes.find((r) => r.key === selectedKey)?.label ?? selectedKey,
    [recipes, selectedKey]
  );

  return (
    <div className="page">
      <header className="header">
        <h1>Ficha Técnica</h1>
        <p>Selecione uma receita e ajuste a volumetria. O app recalcula automaticamente.</p>
      </header>

      <section className="controls">
        <div className="field">
          <label>Receita</label>

          <Select
            classNamePrefix="rs"
            placeholder="Digite para buscar…"
            isClearable={false}
            options={recipes.map(r => ({ value: r.key, label: r.label }))}
            value={
              selectedKey
                ? { value: selectedKey, label: recipes.find(r => r.key === selectedKey)?.label ?? selectedKey }
                : null
            }
            onChange={(opt) => setSelectedKey(opt?.value ?? "")}
          />
        </div>

        <div className="field">
          <label>Volume final desejado (em gr ou ml)</label>
          <input value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="Ex.: 1000" inputMode="decimal" />
          <small>Vazio = 1x (sem multiplicador)</small>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Carregando…</div>}

      {data && !loading && (
        <>
          <section className="cards">
            <div className="card">
              <div className="k">Receita</div>
              <div className="v">{selectedLabel}</div>
            </div>
            <div className="card">
              <div className="k">Volume base</div>
              <div className="v">{nf.format(data.volumeBase)}</div>
            </div>
            <div className="card">
              <div className="k">Custo total por volume</div>
              <div className="v">{mf.format(data.custoTotalPorVolume)}</div>
            </div>
            <div className="card">
              <div className="k">Multiplicador</div>
              <div className="v">{data.multiplier.toFixed(6)}</div>
            </div>
          </section>

          <section className="tableWrap">
            <h2>Ingredientes</h2>

            {!data.headerFound && (
              <div className="warn">
                Não detectei automaticamente a seção “ingredientes” no bloco dessa receita.
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
                  {data.ingredients.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.nome}</td>
                      <td>{it.quantEntrada == null ? "" : nf.format(it.quantEntrada)}</td>
                      <td>{it.quantSaida == null ? "" : nf.format(it.quantSaida)}</td>
                      <td>{it.unidade || "-"}</td>
                      <td>{it.custoUnitario == null ? "" : mf.format(it.custoUnitario)}</td>
                      <td>{it.custoReceita == null ? "" : mf.format(it.custoReceita)}</td>
                    </tr>
                  ))}
                  {data.ingredients.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        Nenhum ingrediente encontrado para esta receita.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="prepWrap">
            <h2>Modo de preparo</h2>
            {data.modoPreparo ? (
              <ol className="prepList">
                {formatModoPreparo(
                  data.modoPreparo,
                  data.ingredients.map((i) => ({
                    nome: i.nome,
                    quantEntrada: i.quantEntrada,
                    unidade: i.unidade,
                  }))
                ).map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ol>
            ) : (
              <div className="muted">Sem modo de preparo cadastrado.</div>
            )}
          </section>
          <section className="validWrap">
            <h2>Validade</h2>
            <div className="validBox">{data.validade || "Sem validade cadastrada."}</div>
          </section>
        </>
      )}
    </div>
  );
}


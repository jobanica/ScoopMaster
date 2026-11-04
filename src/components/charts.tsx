"use client";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell } from "recharts";

// Chart values are converted to numbers for plotting only; all calculations happen server-side in decimal.
export type Series = { key: string; label: string; color: string };
const peso = (v: number) => "₱" + v.toLocaleString("en-PH", { maximumFractionDigits: 0 });
const pesoFull = (v: number) => "₱" + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const PALETTE = ["#7A4E36", "#D9607F", "#3FA67D", "#E0A82E", "#4A86C5", "#B8977F", "#A23A57", "#257556"];

function allZero(data: Record<string, string | number>[], series: Series[]) {
  return data.every((d) => series.every((s) => !Number(d[s.key])));
}

export function BarChartBox({ data, x, series, money = true, height = 260, stacked = false, horizontal = false }: { data: Record<string, string | number>[]; x: string; series: Series[]; money?: boolean; height?: number; stacked?: boolean; horizontal?: boolean }) {
  if (!data.length || allZero(data, series)) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, left: horizontal ? 24 : 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3E1C0" />
        {horizontal ? <XAxis type="number" tickFormatter={money ? peso : undefined} fontSize={11} /> : <XAxis dataKey={x} fontSize={11} />}
        {horizontal ? <YAxis type="category" dataKey={x} width={110} fontSize={11} /> : <YAxis tickFormatter={money ? peso : undefined} fontSize={11} width={70} />}
        <Tooltip formatter={(v: number) => (money ? pesoFull(v) : v.toLocaleString("en-PH"))} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} stackId={stacked ? "a" : undefined} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineChartBox({ data, x, series, money = true, height = 260 }: { data: Record<string, string | number>[]; x: string; series: Series[]; money?: boolean; height?: number }) {
  if (!data.length || allZero(data, series)) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3E1C0" />
        <XAxis dataKey={x} fontSize={11} />
        <YAxis tickFormatter={money ? peso : undefined} fontSize={11} width={70} />
        <Tooltip formatter={(v: number) => (money ? pesoFull(v) : v.toLocaleString("en-PH"))} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PieChartBox({ data, money = true, height = 260 }: { data: { name: string; value: number }[]; money?: boolean; height?: number }) {
  if (!data.length || data.every((d) => d.value === 0)) return <EmptyChart />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => (money ? pesoFull(v) : v.toLocaleString("en-PH"))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function EmptyChart() {
  return <div className="flex h-40 items-center justify-center text-sm text-choco-300">No data for the selected filters</div>;
}

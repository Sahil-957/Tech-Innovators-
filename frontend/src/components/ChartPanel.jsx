import { memo, useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const BIN_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#f472b6']

function ChartCard({ title, data, keys, suffix }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Analytics</p>
        <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.14)" vertical={false} />
            <XAxis dataKey="timeLabel" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{
                background: 'rgba(2, 6, 23, 0.95)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: '16px',
                color: '#e2e8f0',
              }}
              formatter={(value, name) => [`${value}${suffix}`, name]}
              labelStyle={{ color: '#cbd5e1' }}
            />
            <Legend />
            {keys.map((key, index) => (
              <Line
                key={key.dataKey}
                type="monotone"
                dataKey={key.dataKey}
                name={key.label}
                stroke={BIN_COLORS[index % BIN_COLORS.length]}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartPanelComponent({ history, binKeys }) {
  const fillKeys = useMemo(
    () => binKeys.map((binKey) => ({ dataKey: `${binKey}_level`, label: binKey.replace('bin', 'Bin ') })),
    [binKeys],
  )

  const gasKeys = useMemo(
    () => binKeys.map((binKey) => ({ dataKey: `${binKey}_gas`, label: binKey.replace('bin', 'Bin ') })),
    [binKeys],
  )

  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Fill level over time" data={history} keys={fillKeys} suffix="%" />
      <ChartCard title="Gas level over time" data={history} keys={gasKeys} suffix="" />
    </section>
  )
}

export const ChartPanel = memo(ChartPanelComponent)

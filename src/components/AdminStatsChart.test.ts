import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AdminStatsChart from './AdminStatsChart.vue'

const days = [
  { day: '2026-06-22', wallets: 1, opens: 2, handles: 1 },
  { day: '2026-07-21', wallets: 4, opens: 10, handles: 3 },
]

describe('AdminStatsChart', () => {
  it('shows the latest 30 UTC days with missing dates filled as zero', () => {
    const wrapper = mount(AdminStatsChart, { props: { days } })

    expect(wrapper.get('[data-chart-metric="opens"]').attributes('aria-pressed')).toBe('true')
    const points = wrapper.findAll('[data-chart-point]')
    expect(points).toHaveLength(30)
    expect(points[0]!.attributes('data-day')).toBe('2026-06-22')
    expect(points[0]!.attributes('data-value')).toBe('2')
    expect(points[1]!.attributes('data-day')).toBe('2026-06-23')
    expect(points[1]!.attributes('data-value')).toBe('0')
    expect(points[29]!.attributes('data-day')).toBe('2026-07-21')
    expect(points[29]!.attributes('data-value')).toBe('10')
    expect(wrapper.get('[data-chart]').attributes('aria-label')).toContain('Daily opens')
  })

  it('switches between opens, wallets, and handles without sharing scales', async () => {
    const wrapper = mount(AdminStatsChart, { props: { days } })

    await wrapper.get('[data-chart-metric="wallets"]').trigger('click')
    expect(wrapper.get('[data-chart-metric="wallets"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('[data-chart-point]')[29]!.attributes('data-value')).toBe('4')
    expect(wrapper.get('[data-chart]').attributes('aria-label')).toContain('Daily wallets')

    await wrapper.get('[data-chart-metric="handles"]').trigger('click')
    expect(wrapper.get('[data-chart-metric="handles"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('[data-chart-point]')[29]!.attributes('data-value')).toBe('3')
    expect(wrapper.get('[data-chart]').attributes('aria-label')).toContain('Daily handles')
  })

  it('shows the exact date and value for the focused point', async () => {
    const wrapper = mount(AdminStatsChart, { props: { days } })
    await wrapper.findAll('[data-chart-point]')[0]!.trigger('focus')
    expect(wrapper.get('[data-chart-tooltip]').text()).toContain('22 Jun 2026')
    expect(wrapper.get('[data-chart-tooltip]').text()).toContain('2 opens')
  })

  it('shows a quiet empty state when no daily stats exist', () => {
    const wrapper = mount(AdminStatsChart, { props: { days: [] } })
    expect(wrapper.get('[data-chart-empty]').text()).toBe('No daily stats yet.')
    expect(wrapper.find('[data-chart]').exists()).toBe(false)
  })
})

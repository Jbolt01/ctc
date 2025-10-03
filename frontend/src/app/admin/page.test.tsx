import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock next/navigation for router push
const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

// Mock lib/api calls used by the admin page
jest.mock('../../lib/api', () => ({
  adminListUsers: jest.fn(),
  adminSetUserAdmin: jest.fn(),
  adminListTeams: jest.fn(),
  adminCreateTeam: jest.fn(),
  // adminListHours: jest.fn(),
  // adminListCompetitions: jest.fn(),
  // adminCreateCompetition: jest.fn(),
  adminCreateSymbol: jest.fn(),
  adminDeleteSymbol: jest.fn(),
  adminUpsertMarketData: jest.fn(),
  adminPauseSymbols: jest.fn(),
  adminStartSymbols: jest.fn(),
  adminSettleSymbol: jest.fn(),
  adminListSymbols: jest.fn(),
  fetchSymbols: jest.fn(),
}))

import * as api from '../../lib/api'
import AdminPage from './page'

const renderAdmin = async () => {
  const ui = render(<AdminPage />)
  // Wait for auth probe to finish (adminListUsers call in AdminPage.useEffect)
  await waitFor(() => expect(api.adminListUsers).toHaveBeenCalled())
  await waitFor(() => expect(pushMock).not.toHaveBeenCalled())
  return ui
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default happy mock values
  api.adminListUsers.mockResolvedValue([
    { id: 'u1', email: 'a@example.com', name: 'Alice', is_admin: false },
    { id: 'u2', email: 'b@example.com', name: 'Bob', is_admin: true },
  ])
  api.adminListTeams.mockResolvedValue([
    { id: 't1', name: 'Alpha' },
    { id: 't2', name: 'Beta' },
  ])
  // api.adminListHours.mockResolvedValue([
  //   { id: 'h1', symbol: 'AAPL', day_of_week: 1, open_time: '09:30', close_time: '16:00', is_active: true },
  //   { id: 'h2', symbol: 'GOOGL', day_of_week: 5, open_time: '09:30', close_time: '16:00', is_active: false },
  // ])
  // api.adminListCompetitions.mockResolvedValue([
  //   { id: 'c1', name: 'Fall', start_time: '2025-09-01T13:00:00Z', end_time: '2025-09-30T20:00:00Z', is_active: true },
  // ])
  api.adminListSymbols.mockResolvedValue([
    { symbol: 'AAPL', name: 'Apple', trading_halted: false, settlement_active: false },
    { symbol: 'GOOGL', name: 'Alphabet', trading_halted: true },
    { symbol: 'MSFT', name: 'Microsoft', settlement_active: true, settlement_price: 123.45 },
  ])
  api.fetchSymbols.mockResolvedValue({ symbols: [ { symbol: 'AAPL', name: 'Apple' }, { symbol: 'GOOGL', name: 'Alphabet' } ] })
  api.adminSetUserAdmin.mockResolvedValue(undefined)
  api.adminCreateTeam.mockResolvedValue(undefined)
  // api.adminCreateCompetition.mockResolvedValue(undefined)
  api.adminCreateSymbol.mockResolvedValue(undefined)
  api.adminDeleteSymbol.mockResolvedValue(undefined)
  api.adminPauseSymbols.mockResolvedValue(undefined)
  api.adminStartSymbols.mockResolvedValue(undefined)
  api.adminSettleSymbol.mockResolvedValue(undefined)
  api.adminUpsertMarketData.mockResolvedValue(undefined)
})

describe('AdminPage authorization and navigation', () => {
  it('redirects to home if not authorized', async () => {
    api.adminListUsers.mockRejectedValueOnce(new Error('Unauthorized'))
    render(<AdminPage />)
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'))
  })

  it('renders Users panel by default and can switch tabs', async () => {
    await renderAdmin()
    expect(screen.getByText(/ADMIN CONSOLE/i)).toBeInTheDocument()
    // Default tab = Users
    expect(await screen.findByRole('heading', { level: 2, name: 'Users' })).toBeInTheDocument()
    expect(await screen.findByText('Toggle admin access for users')).toBeInTheDocument()

    // Switch to Teams
    await userEvent.click(screen.getByRole('button', { name: 'Teams' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Teams' })).toBeInTheDocument()
    expect(screen.getByText('Create teams and review existing')).toBeInTheDocument()

    // Switch to Symbols
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Symbols' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Symbol/)).toBeInTheDocument()
  })
})

describe('UsersPanel', () => {
  it('loads and displays users, allows toggling admin', async () => {
    await renderAdmin()
    // Two users rendered
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()

    // Toggle Alice -> true
    const toggle = screen.getAllByRole('checkbox')[0]
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(api.adminSetUserAdmin).toHaveBeenCalledWith('u1', true)
  })

  it('rolls back toggle on API error', async () => {
    api.adminSetUserAdmin.mockRejectedValueOnce(new Error('fail'))
    await renderAdmin()
    const toggle = screen.getAllByRole('checkbox')[0]
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    // Optimistic checked then rolled back
    await waitFor(() => expect(toggle).not.toBeChecked())
  })
})

describe('SymbolsPanel', () => {
  it('shows statuses and allows pause/start/delete per symbol', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))

    // Status badges
    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText(/Settled @/)).toBeInTheDocument()

    // Pause specific symbol
    const pauseBtn = screen.getAllByRole('button', { name: 'Pause' })[0]
    const startBtn = screen.getAllByRole('button', { name: 'Start' })[0]
    await userEvent.click(pauseBtn)
    expect(api.adminPauseSymbols).toHaveBeenCalledWith('AAPL')
    await userEvent.click(startBtn)
    expect(api.adminStartSymbols).toHaveBeenCalledWith('AAPL')

    // Delete
    const deleteBtn = screen.getAllByRole('button', { name: 'Delete' })[0]
    await userEvent.click(deleteBtn)
    expect(api.adminDeleteSymbol).toHaveBeenCalledWith('AAPL')
  })

  it('supports Pause All / Start All', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pause All' }))
    expect(api.adminPauseSymbols).toHaveBeenCalledWith(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Start All' }))
    expect(api.adminStartSymbols).toHaveBeenCalledWith(undefined)
  })

  it('falls back to public symbols if admin list fails', async () => {
    ;(api.adminListSymbols as jest.Mock).mockRejectedValueOnce(new Error('403'))
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    await waitFor(() => expect(api.fetchSymbols).toHaveBeenCalled())
    // Should have fetched via fetchSymbols and render AAPL/GOOGL options
    expect(await screen.findAllByRole('option', { name: 'AAPL' })).toBeTruthy()
    expect(screen.getAllByRole('option', { name: 'GOOGL' })).toBeTruthy()
  })

  it('creates symbol and reloads', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    const symInput = screen.getByPlaceholderText(/Symbol/)
    const nameInput = screen.getByPlaceholderText('Name')
    const tickInput = screen.getByPlaceholderText('Tick')
    const lotInput = screen.getByPlaceholderText('Lot')
    await userEvent.type(symInput, 'tsla')
    await userEvent.type(nameInput, 'Tesla')
    await userEvent.clear(tickInput); await userEvent.type(tickInput, '0.05')
    await userEvent.clear(lotInput); await userEvent.type(lotInput, '10')
    await userEvent.click(screen.getByRole('button', { name: 'Create Symbol' }))
    expect(api.adminCreateSymbol).toHaveBeenCalledWith({ symbol: 'TSLA', name: 'Tesla', symbol_type: 'equity', tick_size: 0.05, lot_size: 10 })
    // Reload called
    await waitFor(() => expect(api.adminListSymbols).toHaveBeenCalledTimes(2))
  })

  it('settles a symbol only when both fields provided and resets price', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    const select = screen.getAllByRole('combobox').find(el => within(el).queryByText('Select symbol'))!
    const priceInput = screen.getByPlaceholderText('Settlement price')
    const settleBtn = screen.getByRole('button', { name: 'Settle' })

    // Missing both -> no call
    await userEvent.click(settleBtn)
    expect(api.adminSettleSymbol).not.toHaveBeenCalled()

    // Select symbol but no price -> no call
    await userEvent.selectOptions(select, 'AAPL')
    await userEvent.click(settleBtn)
    expect(api.adminSettleSymbol).not.toHaveBeenCalled()

    // Provide price and call
    await userEvent.type(priceInput, '150.25')
    await userEvent.click(settleBtn)
    expect(api.adminSettleSymbol).toHaveBeenCalledWith('AAPL', 150.25)
  })
})

describe('TeamsPanel', () => {
  it('lists and creates teams', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Teams' }))
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText('Team name')
    await userEvent.type(nameInput, 'Gamma')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(api.adminCreateTeam).toHaveBeenCalledWith({ name: 'Gamma' })
    await waitFor(() => expect(api.adminListTeams).toHaveBeenCalledTimes(2))
  })
})

// describe('HoursPanel', () => {
//   it('renders table of trading hours', async () => {
//     await renderAdmin()
//     await userEvent.click(screen.getByRole('button', { name: 'Trading Hours' }))
//     // Verify rows content (Mon for 1, Fri for 5)
//     expect(await screen.findByText('AAPL')).toBeInTheDocument()
//     expect(screen.getByText('Mon')).toBeInTheDocument()
//     expect(screen.getByText('Fri')).toBeInTheDocument()
//     expect(screen.getAllByText('09:30').length).toBeGreaterThan(0)
//   })
// })

// describe('CompetitionsPanel', () => {
//   it('lists and creates competitions', async () => {
//     await renderAdmin()
//     await userEvent.click(screen.getByRole('button', { name: 'Competitions' }))
//     expect(await screen.findByText('Fall')).toBeInTheDocument()
//     await userEvent.type(screen.getByPlaceholderText('Name'), 'Spring')
//     // datetime-local inputs
//     const dts = screen.getAllByDisplayValue('')
//     await userEvent.type(dts[0], '2025-03-01T09:00')
//     await userEvent.type(dts[1], '2025-03-31T17:00')
//     await userEvent.click(screen.getByLabelText(/Active/))
//     await userEvent.click(screen.getByRole('button', { name: 'Create Competition' }))
//     expect(api.adminCreateCompetition).toHaveBeenCalledWith({ name: 'Spring', start_time: '2025-03-01T09:00', end_time: '2025-03-31T17:00', is_active: true })
//     await waitFor(() => expect(api.adminListCompetitions).toHaveBeenCalledTimes(2))
//   })
// })

describe('MarketDataPanel', () => {
  it('upserts close price for a symbol', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Market Data' }))
    // Select symbol and set price
    await userEvent.selectOptions(screen.getByRole('combobox'), 'AAPL')
    const price = screen.getByPlaceholderText('Close price')
    await userEvent.type(price, '199.99')
    await userEvent.click(screen.getByRole('button', { name: 'Upsert' }))
    expect(api.adminUpsertMarketData).toHaveBeenCalledWith({ symbol: 'AAPL', close: 199.99 })
  })
})

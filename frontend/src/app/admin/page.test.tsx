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
  adminDisableUser: jest.fn(),
  adminEnableUser: jest.fn(),
  adminDeleteUser: jest.fn(),
  adminListTeams: jest.fn(),
  adminCreateTeam: jest.fn(),
  adminGetTeam: jest.fn(),
  adminDisableTeamApiKey: jest.fn(),
  adminEnableTeamApiKey: jest.fn(),
  adminListAllowedEmails: jest.fn(),
  adminAddAllowedEmail: jest.fn(),
  adminDeleteAllowedEmail: jest.fn(),
  adminCreateSymbol: jest.fn(),
  adminDeleteSymbol: jest.fn(),
  adminPauseSymbols: jest.fn(),
  adminStartSymbols: jest.fn(),
  adminSettleSymbol: jest.fn(),
  adminListSymbols: jest.fn(),
  adminListLimits: jest.fn(),
  adminCreateLimit: jest.fn(),
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
    { id: 'u1', email: 'a@example.com', name: 'Alice', is_admin: false, team_name: 'Team Alpha', is_disabled: false },
    { id: 'u2', email: 'b@example.com', name: 'Bob', is_admin: true, team_name: 'Team Beta', is_disabled: true },
  ])
  api.adminListTeams.mockResolvedValue([
    { id: 't1', name: 'Alpha', member_count: 1, join_code: 'ABC' },
    { id: 't2', name: 'Beta', member_count: 2, join_code: 'DEF' },
  ])
  api.adminListSymbols.mockResolvedValue([
    { symbol: 'AAPL', name: 'Apple', trading_halted: false, settlement_active: false },
    { symbol: 'GOOGL', name: 'Alphabet', trading_halted: true },
    { symbol: 'MSFT', name: 'Microsoft', settlement_active: true, settlement_price: 123.45 },
  ])
  api.adminListLimits.mockResolvedValue([
    { id: 'l1', symbol: 'AAPL', max_position: 1000, max_order_size: 100 },
  ])
  api.fetchSymbols.mockResolvedValue({ symbols: [ { symbol: 'AAPL', name: 'Apple' }, { symbol: 'GOOGL', name: 'Alphabet' } ] })
  api.adminSetUserAdmin.mockResolvedValue(undefined)
  api.adminCreateTeam.mockResolvedValue(undefined)
  api.adminCreateSymbol.mockResolvedValue(undefined)
  api.adminDeleteSymbol.mockResolvedValue(undefined)
  api.adminPauseSymbols.mockResolvedValue(undefined)
  api.adminStartSymbols.mockResolvedValue(undefined)
  api.adminSettleSymbol.mockResolvedValue(undefined)
  api.adminCreateLimit.mockResolvedValue(undefined)
  api.adminListAllowedEmails.mockResolvedValue(['test1@example.com', 'test2@example.com'])
  api.adminAddAllowedEmail.mockResolvedValue(undefined)
  api.adminDeleteAllowedEmail.mockResolvedValue(undefined)
  api.adminDisableUser.mockResolvedValue(undefined)
  api.adminEnableUser.mockResolvedValue(undefined)
  api.adminDeleteUser.mockResolvedValue(undefined)
  api.adminGetTeam.mockResolvedValue({ id: 't1', name: 'Alpha', join_code: 'ABC', members: [], api_keys: [] })
  api.adminDisableTeamApiKey.mockResolvedValue(undefined)
  api.adminEnableTeamApiKey.mockResolvedValue(undefined)
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

    // Switch to Emails
    await userEvent.click(screen.getByRole('button', { name: 'Emails' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Allowed Emails' })).toBeInTheDocument()
    expect(screen.getByText('Manage registration whitelist')).toBeInTheDocument()

    // Switch to Symbols
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Symbols' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Symbol/)).toBeInTheDocument()
  })
})

describe('UsersPanel', () => {
  it('loads and displays users, allows toggling admin and status', async () => {
    await renderAdmin()
    // Two users rendered
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()

    // Team name is displayed
    expect(screen.getByText('Team Alpha')).toBeInTheDocument()

    // Toggle Alice -> true
    const toggle = screen.getAllByRole('checkbox')[0]
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(api.adminSetUserAdmin).toHaveBeenCalledWith('u1', true)

    // Disable user
    const disableBtn = screen.getAllByRole('button', { name: 'Disable' })[0]
    await userEvent.click(disableBtn)
    expect(api.adminDisableUser).toHaveBeenCalledWith('u1')

    // Delete user
    window.confirm = jest.fn(() => true) // auto-confirm
    const deleteBtn = screen.getAllByRole('button', { name: 'Delete' })[0]
    await userEvent.click(deleteBtn)
    expect(api.adminDeleteUser).toHaveBeenCalledWith('u1')
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

  it('filters users by search term', async () => {
    await renderAdmin()
    await userEvent.type(screen.getByPlaceholderText('Search by name or email...'), 'alice')
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
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

  it('displays position limits for symbols', async () => {
    await renderAdmin();
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }));
    expect(await screen.findByText('Limit: 1000')).toBeInTheDocument();
  });

  it('sets a position limit for a symbol', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    const select = screen.getByRole('combobox', { name: /select symbol to limit/i })
    const maxPosInput = screen.getByPlaceholderText('Max Position')
    const maxOrderInput = screen.getByPlaceholderText('Max Order (optional)')
    const setLimitBtn = screen.getByRole('button', { name: 'Set Limit' })

    // Select symbol, provide only max position
    await userEvent.selectOptions(select, 'AAPL')
    await userEvent.type(maxPosInput, '2000')
    await userEvent.click(setLimitBtn)
    // max_order_size should be omitted
    expect(api.adminCreateLimit).toHaveBeenCalledWith({ symbol: 'AAPL', max_position: 2000, applies_to_admin: false })

    // Provide both
    await userEvent.clear(maxOrderInput); await userEvent.type(maxOrderInput, '500')
    await userEvent.click(setLimitBtn)
    expect(api.adminCreateLimit).toHaveBeenCalledWith({ symbol: 'AAPL', max_position: 2000, max_order_size: 500, applies_to_admin: false })
  })

  it('settles a symbol', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Symbols' }))
    const select = screen.getByRole('combobox', { name: /select symbol to settle/i })
    const priceInput = screen.getByPlaceholderText('Settlement price')
    const settleBtn = screen.getByRole('button', { name: 'Settle' })

    // Select symbol and provide price
    await userEvent.selectOptions(select, 'AAPL')
    await userEvent.type(priceInput, '150.25')
    await userEvent.click(settleBtn)
    expect(api.adminSettleSymbol).toHaveBeenCalledWith('AAPL', 150.25)
  })
})

describe('TeamsPanel', () => {
  it('lists and creates teams, shows member count, and links to details', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Teams' }))
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('1 members')).toBeInTheDocument()

    // Check link
    const link = screen.getByText('Alpha')
    expect(link.closest('a')).toHaveAttribute('href', '/admin/teams/t1')

    const nameInput = screen.getByPlaceholderText('Team name')
    await userEvent.type(nameInput, 'Gamma')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(api.adminCreateTeam).toHaveBeenCalledWith({ name: 'Gamma' })
    await waitFor(() => expect(api.adminListTeams).toHaveBeenCalledTimes(2))
  })

  it('filters teams by search term', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Teams' }))
    await userEvent.type(screen.getByPlaceholderText('Search by name...'), 'alpha')
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})

describe('EmailsPanel', () => {
  it('lists, adds, deletes, and filters emails', async () => {
    await renderAdmin()
    await userEvent.click(screen.getByRole('button', { name: 'Emails' }))

    // List
    expect(await screen.findByText('test1@example.com')).toBeInTheDocument()
    expect(screen.getByText('test2@example.com')).toBeInTheDocument()

    // Add
    await userEvent.type(screen.getByPlaceholderText('new.email@example.com'), 'test3@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(api.adminAddAllowedEmail).toHaveBeenCalledWith('test3@example.com')
    await waitFor(() => expect(api.adminListAllowedEmails).toHaveBeenCalledTimes(2))

    // Delete
    const deleteButtons = screen.getAllByRole('button', { name: 'Remove' })
    await userEvent.click(deleteButtons[0])
    expect(api.adminDeleteAllowedEmail).toHaveBeenCalledWith('test1@example.com')
    await waitFor(() => expect(api.adminListAllowedEmails).toHaveBeenCalledTimes(3))

    // Filter
    await userEvent.type(screen.getByPlaceholderText('Search emails...'), 'test2')
    expect(screen.queryByText('test1@example.com')).not.toBeInTheDocument()
    expect(screen.getByText('test2@example.com')).toBeInTheDocument()
  })
})

import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

jest.mock('../../lib/api', () => ({
  teamGet: jest.fn(),
  teamUpdateName: jest.fn(),
  teamRotateCode: jest.fn(),
  teamRemoveMember: jest.fn(),
  listTeamApiKeys: jest.fn(),
  createTeamApiKey: jest.fn(),
  revokeTeamApiKey: jest.fn(),
}))

import * as api from '../../lib/api'
import TeamSettingsPage from './page'

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.setItem('apiKey', 'k')
})

describe('TeamSettingsPage', () => {
  it('renders view for member (no edit controls)', async () => {
    ;(api.teamGet as jest.Mock).mockResolvedValue({
      id: 't1', name: "Owner's Team", join_code: 'ABCDEFGH', role: 'member', members: [
        { id: 'u1', email: 'a@example.com', name: 'Alice', role: 'admin' },
        { id: 'u2', email: 'b@example.com', name: 'Bob', role: 'member' },
      ]
    })
    render(<TeamSettingsPage />)
    expect(await screen.findByText("Owner's Team")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('allows owner to rename, rotate code, and remove member', async () => {
    ;(api.teamGet as jest.Mock).mockResolvedValue({
      id: 't1', name: 'Team One', join_code: 'ABCDEFGH', role: 'admin', members: [
        { id: 'u1', email: 'owner@example.com', name: 'Owner', role: 'admin' },
        { id: 'u2', email: 'mem@example.com', name: 'Member', role: 'member' },
      ]
    })
    ;(api.listTeamApiKeys as jest.Mock).mockResolvedValue([])
    ;(api.teamRotateCode as jest.Mock).mockResolvedValue({ join_code: 'ZZZZZZZZ' })
    ;(api.teamUpdateName as jest.Mock).mockResolvedValue({ status: 'ok' })
    ;(api.teamRemoveMember as jest.Mock).mockResolvedValue({ status: 'removed' })

    render(<TeamSettingsPage />)
    const input = await screen.findByDisplayValue('Team One') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Team' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.teamUpdateName).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }))
    await waitFor(() => expect(api.teamRotateCode).toHaveBeenCalled())
    const removeButtons = await screen.findAllByRole('button', { name: 'Remove' })
    await userEvent.click(removeButtons[0])
    await waitFor(() => expect(api.teamRemoveMember).toHaveBeenCalled())
  })

  it('shows API keys for owner, allows create and revoke', async () => {
    ;(api.teamGet as jest.Mock).mockResolvedValue({
      id: 't1', name: 'Team One', join_code: 'ABCDEFGH', role: 'admin', members: []
    })
    ;(api.listTeamApiKeys as jest.Mock).mockResolvedValue([
      { id: 'k1', name: 'Bot 1', created_at: new Date('2024-01-01').toISOString(), last_used: null, is_active: true },
    ])
    ;(api.createTeamApiKey as jest.Mock).mockResolvedValue({
      id: 'k2', name: 'New Bot', created_at: new Date('2024-01-02').toISOString(), api_key: 'secret-key'
    })
    ;(api.revokeTeamApiKey as jest.Mock).mockResolvedValue({ status: 'revoked', id: 'k1' })

    render(<TeamSettingsPage />)

    // Keys list loads and shows existing key
    expect(await screen.findByText('API Keys')).toBeInTheDocument()
    expect(await screen.findByText('Bot 1')).toBeInTheDocument()

    // Create a key
    const nameInput = screen.getByLabelText('API key name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'New Bot' } })
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.createTeamApiKey).toHaveBeenCalledWith('New Bot'))
    expect(await screen.findByText(/Copy your new API key now/)).toBeInTheDocument()

    // Dismiss banner
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/Copy your new API key now/)).toBeNull())

    // Revoke an existing key
    const revokeBtn = await screen.findByRole('button', { name: 'Revoke' })
    await userEvent.click(revokeBtn)
    await waitFor(() => expect(api.revokeTeamApiKey).toHaveBeenCalledWith('k1'))
  })
})

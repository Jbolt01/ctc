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
})

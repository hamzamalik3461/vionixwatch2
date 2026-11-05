import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { PopoverTitle } from './popover'

describe('overlays', () => {
  it('renders submenu actions outside the scrolling menu and permits selection', async () => {
    const selected = vi.fn()
    const user = userEvent.setup()
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={selected}>
                Export PDF
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole('menuitem', { name: 'Export' }))
    const action = await screen.findByRole('menuitem', { name: 'Export PDF' })
    const parentMenu = screen
      .getByRole('menuitem', { name: 'Export' })
      .closest('[role="menu"]')
    expect(parentMenu).not.toContainElement(action)
    action.focus()
    await user.keyboard('{Enter}')
    expect(selected).toHaveBeenCalledTimes(1)
  })

  it('keeps menu actions inside a supplied fullscreen player container', async () => {
    const selected = vi.fn()
    function Player() {
      const [container, setContainer] = useState<HTMLDivElement | null>(null)
      return (
        <div ref={setContainer} data-testid="fullscreen-player">
          <DropdownMenu>
            <DropdownMenuTrigger>Playback speed</DropdownMenuTrigger>
            <DropdownMenuContent container={container}>
              <DropdownMenuItem onSelect={selected}>1.5×</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    }
    const user = userEvent.setup()
    render(<Player />)
    await user.click(screen.getByRole('button', { name: 'Playback speed' }))
    const option = await screen.findByRole('menuitem', { name: '1.5×' })
    expect(screen.getByTestId('fullscreen-player')).toContainElement(option)
    await user.click(option)
    expect(selected).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('exposes the popover title as a level-two heading', () => {
    render(<PopoverTitle>Display settings</PopoverTitle>)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Display settings' }),
    ).toBeVisible()
  })
})

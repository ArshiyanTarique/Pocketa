// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useStore } from '../store/useStore';
import { today } from '../core/dates';
import { rs } from '../test/fixtures';
import { Budgets } from './Budgets';

// jsdom has no matchMedia; the sheet only asks it whether the viewport is wide.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
});

let ns = 0;
beforeEach(async () => {
  await useStore.getState().init(`budgets_${Date.now()}_${++ns}`);
});
afterEach(cleanup);

const s = () => useStore.getState();

/**
 * Making a budget is one number and one tap. Everything else has a sensible
 * default and stays out of the way until someone asks for it.
 */
describe('making a budget', () => {
  it('takes an amount and a category, and names itself', async () => {
    render(<Budgets />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a budget' }));

    fireEvent.change(screen.getByLabelText('How much a month?'), { target: { value: '20,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Food & Drink' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create budget' }));

    await waitFor(() => expect(s().budgets).toHaveLength(1));
    const [budget] = s().budgets;
    const food = s().accounts.find((a) => a.name === 'Food & Drink')!;
    expect(budget.name).toBe('Food & Drink');
    expect(budget.categoryIds).toEqual([food.id]);
    expect(budget.limit).toBe(rs(20000));
    expect(budget.period).toBe('monthly');
    expect(budget.startsOn).toBe(today());
  });

  it('can cover everything with one tap', async () => {
    render(<Budgets />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a budget' }));

    fireEvent.change(screen.getByLabelText('How much a month?'), { target: { value: '150000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create budget' }));

    await waitFor(() => expect(s().budgets).toHaveLength(1));
    expect(s().budgets[0].categoryIds).toEqual([]);
    expect(s().budgets[0].name).toBe('Everything');
  });

  it('will not save until it knows what the budget is for', async () => {
    render(<Budgets />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a budget' }));

    fireEvent.change(screen.getByLabelText('How much a month?'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create budget' }));

    expect(await screen.findByText('Pick what this budget is for.')).toBeTruthy();
    expect(s().budgets).toHaveLength(0);
  });

  it('keeps the fine-tuning out of sight until asked', () => {
    render(<Budgets />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a budget' }));

    expect(screen.queryByText('Warn me at')).toBeNull();
    expect(screen.queryByText('At month end')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /More options/ }));

    expect(screen.getByText('Warn me at')).toBeTruthy();
    expect(screen.getByText('At month end')).toBeTruthy();
  });
});

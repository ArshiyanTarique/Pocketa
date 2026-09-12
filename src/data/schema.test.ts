/**
 * The server schema, checked as text.
 *
 * These scripts are handed to a user to paste into a Postgres console, so
 * nothing runs them here. But the mistakes that matter most are visible in the
 * text: a table created and then never protected, a policy written for select
 * but not insert, a claim in the README that the SQL does not actually make
 * true. A forgotten `enable row level security` is the single most common way a
 * Supabase project leaks every row it has, and it is exactly the kind of thing
 * that is added in a hurry and never noticed again.
 */

import { describe, it, expect } from 'vitest';
import { SCHEMA_SQL } from './sync';
import { CARPOOL_SCHEMA_SQL, CARPOOL_PRIVACY_NOTES } from './carpoolSchema';

const both = `${SCHEMA_SQL}\n${CARPOOL_SCHEMA_SQL}`;

function tablesIn(sql: string): string[] {
  return [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
}

describe('every table is protected', () => {
  it('enables row level security on all of them', () => {
    const unprotected = tablesIn(both).filter(
      (table) => !new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(both),
    );
    expect(unprotected).toEqual([]);
  });

  it('gives every table at least a read policy', () => {
    const unreadable = tablesIn(both).filter(
      (table) => !new RegExp(`on public\\.${table}\\s+for (select|all)`, 's').test(both),
    );
    expect(unreadable).toEqual([]);
  });

  it('creates the tables the app actually writes to', () => {
    expect(tablesIn(both).sort()).toEqual(
      [
        'carpool_contacts',
        'carpool_invites',
        'carpool_profiles',
        'carpool_rides',
        'carpool_routes',
        'carpool_teams',
        'ops',
        'team_memberships',
      ].sort(),
    );
  });
});

describe('the ledger table', () => {
  it('scopes every operation to the signed-in account', () => {
    for (const action of ['select', 'insert', 'update']) {
      expect(SCHEMA_SQL).toMatch(new RegExp(`for ${action}[\\s\\S]{0,80}auth\\.uid\\(\\) = user_id`));
    }
  });

  it('is append-only in both directions, not just against deletes', () => {
    // A delete policy alone left "append-only" half true: an update could blank
    // a row and leave its id in place.
    expect(SCHEMA_SQL).toMatch(/for delete using \(false\)/);
    expect(SCHEMA_SQL).toMatch(/create trigger ops_immutable/);
    expect(SCHEMA_SQL).toMatch(/ops are append-only/);
  });

  it('freezes every column that describes what happened', () => {
    for (const column of ['id', 'user_id', 'device_id', 'lamport', 'created_at', 'type', 'entity', 'entity_id', 'summary', 'changes', 'snapshot']) {
      expect(SCHEMA_SQL).toMatch(new RegExp(`new\\.${column}\\s+is distinct from old\\.${column}`));
    }
  });

  it('never reissues a sequence number on a repeated push', () => {
    expect(SCHEMA_SQL).toMatch(/new\.server_seq := old\.server_seq/);
  });
});

describe('the carpool tables', () => {
  it('keeps phone numbers in a table of their own', () => {
    expect(CARPOOL_SCHEMA_SQL).toMatch(/create table if not exists public\.carpool_contacts/);
    // The profile table must not carry one, or separating them buys nothing.
    const profiles = CARPOOL_SCHEMA_SQL.slice(
      CARPOOL_SCHEMA_SQL.indexOf('create table if not exists public.carpool_profiles'),
      CARPOOL_SCHEMA_SQL.indexOf('create table if not exists public.carpool_contacts'),
    );
    expect(profiles).not.toMatch(/phone/);
  });

  it('only releases a number to somebody on the same active team', () => {
    expect(CARPOOL_SCHEMA_SQL).toMatch(/contacts readable[\s\S]{0,200}shares_active_team/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/status = 'active'/);
  });

  it('allows one route per team, which is what the app assumes', () => {
    const routes = CARPOOL_SCHEMA_SQL.slice(
      CARPOOL_SCHEMA_SQL.indexOf('create table if not exists public.carpool_routes'),
      CARPOOL_SCHEMA_SQL.indexOf('create table if not exists public.team_memberships'),
    );
    expect(routes).toMatch(/unique \(team_id\)/);
  });

  it('allows one membership per person per team', () => {
    expect(CARPOOL_SCHEMA_SQL).toMatch(/unique \(team_id, user_id\)/);
  });

  it('constrains every enum column rather than trusting the client', () => {
    expect(CARPOOL_SCHEMA_SQL).toMatch(/default_role in \('driver','passenger'\)/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/role in \('driver','passenger'\)/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/status in \('invited','requested','active','declined','removed'\)/);
  });

  it('refuses money and geometry that cannot be real', () => {
    expect(CARPOOL_SCHEMA_SQL).toMatch(/rate_per_trip >= 0/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/rate_snapshot >= 0/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/seats_total between 1 and 8/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/pickup_radius_metres between 100 and 10000/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/jsonb_array_length\(path\) >= 2/);
  });

  it('requires an active membership to say when it began', () => {
    expect(CARPOOL_SCHEMA_SQL).toMatch(/status <> 'active' or joined_at is not null/);
  });

  it('cascades from the account, so deleting a user leaves nothing behind', () => {
    const cascades = CARPOOL_SCHEMA_SQL.match(/references auth\.users\(id\) on delete cascade/g) ?? [];
    const userRefs = CARPOOL_SCHEMA_SQL.match(/references auth\.users\(id\)/g) ?? [];
    expect(cascades.length).toBe(userRefs.length);
  });

  it('cascades from the team, so deleting one leaves no stranded rows', () => {
    const cascades = CARPOOL_SCHEMA_SQL.match(/references public\.carpool_teams\(id\) on delete cascade/g) ?? [];
    const teamRefs = CARPOOL_SCHEMA_SQL.match(/references public\.carpool_teams\(id\)/g) ?? [];
    expect(cascades.length).toBe(teamRefs.length);
    expect(cascades.length).toBeGreaterThan(0);
  });

  it('redeems an invite through a function, so tokens cannot be listed', () => {
    expect(CARPOOL_SCHEMA_SQL).toMatch(/create or replace function public\.redeem_carpool_invite/);
    expect(CARPOOL_SCHEMA_SQL).toMatch(/security definer/i);
  });

  it('breaks policy recursion with definer functions rather than sub-selects', () => {
    for (const fn of ['is_active_member', 'is_team_driver', 'shares_active_team', 'drives_discoverable_team']) {
      expect(CARPOOL_SCHEMA_SQL).toMatch(new RegExp(`create or replace function public\\.${fn}`));
    }
  });

  it('says in plain words what it shares, next to the rules that do it', () => {
    expect(CARPOOL_PRIVACY_NOTES.length).toBeGreaterThan(4);
    expect(CARPOOL_PRIVACY_NOTES.join(' ')).toMatch(/pending request never releases a number/i);
  });
});

describe('both scripts', () => {
  it('can be run more than once without error', () => {
    // Postgres has no `create policy if not exists`, so a second paste fails
    // unless each one is dropped first. The instructions promise these are safe
    // to re-run; this is what makes that true.
    const undropped = [...both.matchAll(/create policy "([^"]+)" on (public\.\w+)/g)].filter(
      ([, name, table]) => !both.includes(`drop policy if exists "${name}" on ${table};`),
    );
    expect(undropped.map(([, name]) => name)).toEqual([]);

    // Tables, indexes, functions and triggers guard themselves.
    expect(both).not.toMatch(/^create table (?!if not exists)/m);
    expect(both).not.toMatch(/^create index (?!if not exists)/m);
    for (const trigger of both.match(/create trigger (\w+)/g) ?? []) {
      const name = trigger.replace('create trigger ', '');
      expect(both).toMatch(new RegExp(`drop trigger if exists ${name}`));
    }
  });
});

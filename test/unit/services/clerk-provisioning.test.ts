import { expect } from 'chai';

import {
  deriveOrgName,
  provisionCustomer,
} from '../../../src/services/clerk-provisioning';

interface FakeUser {
  id: string;
  emailAddresses: string[];
}

interface FakeOrg {
  id: string;
  name: string;
  createdBy: string;
  publicMetadata: Record<string, unknown>;
}

function makeFakeClerk() {
  const state = {
    users: [] as FakeUser[],
    orgs: [] as FakeOrg[],
    memberships: [] as { userId: string; orgId: string }[],
    userIdSeq: 0,
    orgIdSeq: 0,
  };

  const client = {
    users: {
      async getUserList({ emailAddress }: { emailAddress?: string[] }) {
        const wanted = emailAddress?.[0];
        const matches = state.users.filter((u) => u.emailAddresses.includes(wanted ?? ''));
        return { data: matches, totalCount: matches.length };
      },
      async createUser({ emailAddress }: { emailAddress?: string[] }) {
        const id = `user_${++state.userIdSeq}`;
        const u: FakeUser = { id, emailAddresses: emailAddress ?? [] };
        state.users.push(u);
        return u;
      },
      async getOrganizationMembershipList({ userId }: { userId: string }) {
        const mine = state.memberships.filter((m) => m.userId === userId);
        const data = mine.map((m) => {
          const org = state.orgs.find((o) => o.id === m.orgId)!;
          return { organization: { id: org.id, name: org.name } };
        });
        return { data, totalCount: data.length };
      },
    },
    organizations: {
      async createOrganization({
        name,
        createdBy,
        publicMetadata,
      }: {
        name: string;
        createdBy: string;
        publicMetadata?: Record<string, unknown>;
      }) {
        const id = `org_${++state.orgIdSeq}`;
        const org: FakeOrg = { id, name, createdBy, publicMetadata: publicMetadata ?? {} };
        state.orgs.push(org);
        state.memberships.push({ userId: createdBy, orgId: id });
        return org;
      },
      async updateOrganizationMetadata(
        orgId: string,
        { publicMetadata }: { publicMetadata: Record<string, unknown> }
      ) {
        const org = state.orgs.find((o) => o.id === orgId);
        if (!org) throw new Error(`org ${orgId} not found`);
        org.publicMetadata = { ...org.publicMetadata, ...publicMetadata };
        return org;
      },
    },
    _state: state,
  };

  return client;
}

describe('services/clerk-provisioning — deriveOrgName', () => {
  it("derives from the email local part", () => {
    expect(deriveOrgName('alice@acme.com')).to.equal("alice's Organization");
    expect(deriveOrgName('bob+test@example.com')).to.equal("bob+test's Organization");
  });

  it('falls back to `my` when the email has no local part', () => {
    expect(deriveOrgName('@nohost')).to.equal("my's Organization");
  });
});

describe('services/clerk-provisioning — provisionCustomer', () => {
  it('creates a Clerk user + org when the email is unknown', async () => {
    const clerk = makeFakeClerk();
    const res = await provisionCustomer(
      {
        email: 'new@acme.com',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        trialEndAt: 1_700_000_000_000,
      },
      clerk as unknown as Parameters<typeof provisionCustomer>[1]
    );
    expect(res.reused).to.equal(false);
    expect(clerk._state.users).to.have.length(1);
    expect(clerk._state.orgs).to.have.length(1);
    expect(clerk._state.orgs[0].publicMetadata).to.deep.include({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      trialEndAt: 1_700_000_000_000,
      source: 'fratellisoftware-com',
    });
    expect(clerk._state.orgs[0].createdBy).to.equal(clerk._state.users[0].id);
  });

  it('re-uses existing user + first org and updates metadata on replay', async () => {
    const clerk = makeFakeClerk();
    await provisionCustomer(
      {
        email: 'x@acme.com',
        stripeCustomerId: 'cus_A',
        stripeSubscriptionId: 'sub_A',
        trialEndAt: null,
      },
      clerk as unknown as Parameters<typeof provisionCustomer>[1]
    );
    const res = await provisionCustomer(
      {
        email: 'x@acme.com',
        stripeCustomerId: 'cus_B',
        stripeSubscriptionId: 'sub_B',
        trialEndAt: 42,
      },
      clerk as unknown as Parameters<typeof provisionCustomer>[1]
    );
    expect(res.reused).to.equal(true);
    expect(clerk._state.users).to.have.length(1);
    expect(clerk._state.orgs).to.have.length(1);
    expect(clerk._state.orgs[0].publicMetadata).to.deep.include({
      stripeCustomerId: 'cus_B',
      stripeSubscriptionId: 'sub_B',
      trialEndAt: 42,
    });
  });

  it('creates a fresh org when an existing user has no memberships', async () => {
    const clerk = makeFakeClerk();
    // Seed a user with no org memberships.
    await clerk.users.createUser({ emailAddress: ['orphan@acme.com'] });
    const res = await provisionCustomer(
      {
        email: 'orphan@acme.com',
        stripeCustomerId: 'cus_O',
        stripeSubscriptionId: 'sub_O',
        trialEndAt: null,
      },
      clerk as unknown as Parameters<typeof provisionCustomer>[1]
    );
    expect(res.reused).to.equal(true);
    expect(clerk._state.users).to.have.length(1);
    expect(clerk._state.orgs).to.have.length(1);
    expect(clerk._state.orgs[0].createdBy).to.equal(clerk._state.users[0].id);
  });
});

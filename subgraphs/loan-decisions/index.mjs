import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@shareable"])

  type Query {
    loanDecisionEvents(loanRequestId: ID!): LoanDecisionEvents!
  }

  type Mutation {
    recordLoanApprovalNeeded(input: LoanApprovalNeededInput!): LoanApprovalNeededEvent!
    recordLoanAutomaticallyApproved(input: LoanAutomatedDecisionInput!): LoanAutomaticallyApprovedEvent!
    recordLoanAutomaticallyDenied(input: LoanAutomatedDecisionInput!): LoanAutomaticallyDeniedEvent!
    recordLoanManuallyApproved(input: LoanManualDecisionInput!): LoanManuallyApprovedEvent!
    recordLoanManuallyDenied(input: LoanManualDecisionInput!): LoanManuallyDeniedEvent!
  }

  type LoanDecisionEvents {
    approvalsNeeded: [LoanApprovalNeededEvent!]!
    automaticApprovals: [LoanAutomaticallyApprovedEvent!]!
    automaticDenials: [LoanAutomaticallyDeniedEvent!]!
    manualApprovals: [LoanManuallyApprovedEvent!]!
    manualDenials: [LoanManuallyDeniedEvent!]!
  }

  union LoanDecisionEvent = LoanApprovalNeededEvent | LoanAutomaticallyApprovedEvent | LoanAutomaticallyDeniedEvent | LoanManuallyApprovedEvent | LoanManuallyDeniedEvent

  type LoanApprovalNeededEvent {
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  input LoanApprovalNeededInput {
    loanId: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  type LoanAutomaticallyApprovedEvent {
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  type LoanAutomaticallyDeniedEvent {
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  input LoanAutomatedDecisionInput {
    loanId: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  type LoanManuallyApprovedEvent {
    LoanRequestID: ID!
    ApproverName: String!
    LoanManualDecisionTimestamp: String!
  }

  type LoanManuallyDeniedEvent {
    LoanRequestID: ID!
    ApproverName: String!
    LoanManualDecisionTimestamp: String!
  }

  input LoanManualDecisionInput {
    loanId: ID!
    ApproverName: String!
    LoanManualDecisionTimestamp: String!
  }
`;

const loanDecisionStore = new Map();

const ensureRecord = (loanRequestId) => {
  if (!loanDecisionStore.has(loanRequestId)) {
    loanDecisionStore.set(loanRequestId, {
      approvalsNeeded: [],
      automaticApprovals: [],
      automaticDenials: [],
      manualApprovals: [],
      manualDenials: []
    });
  }
  return loanDecisionStore.get(loanRequestId);
};

const resolveDecisionType = (event) => event?.__typename ?? null;

const resolvers = {
  Query: {
    loanDecisionEvents: (_, { loanRequestId }) => {
      const record = ensureRecord(loanRequestId);
      return {
        approvalsNeeded: record.approvalsNeeded,
        automaticApprovals: record.automaticApprovals,
        automaticDenials: record.automaticDenials,
        manualApprovals: record.manualApprovals,
        manualDenials: record.manualDenials
      };
    }
  },
  Mutation: {
    recordLoanApprovalNeeded: (_, { input }) => {
      const record = ensureRecord(input.loanId);
      const event = {
        __typename: 'LoanApprovalNeededEvent',
        LoanRequestID: input.loanId,
        LoanAutomatedDecisionTimestamp: input.LoanAutomatedDecisionTimestamp
      };
      record.approvalsNeeded.push(event);
      return event;
    },
    recordLoanAutomaticallyApproved: (_, { input }) => {
      const record = ensureRecord(input.loanId);
      const event = {
        __typename: 'LoanAutomaticallyApprovedEvent',
        LoanRequestID: input.loanId,
        LoanAutomatedDecisionTimestamp: input.LoanAutomatedDecisionTimestamp
      };
      record.automaticApprovals.push(event);
      return event;
    },
    recordLoanAutomaticallyDenied: (_, { input }) => {
      const record = ensureRecord(input.loanId);
      const event = {
        __typename: 'LoanAutomaticallyDeniedEvent',
        LoanRequestID: input.loanId,
        LoanAutomatedDecisionTimestamp: input.LoanAutomatedDecisionTimestamp
      };
      record.automaticDenials.push(event);
      return event;
    },
    recordLoanManuallyApproved: (_, { input }) => {
      const record = ensureRecord(input.loanId);
      const event = {
        __typename: 'LoanManuallyApprovedEvent',
        LoanRequestID: input.loanId,
        ApproverName: input.ApproverName,
        LoanManualDecisionTimestamp: input.LoanManualDecisionTimestamp
      };
      record.manualApprovals.push(event);
      return event;
    },
    recordLoanManuallyDenied: (_, { input }) => {
      const record = ensureRecord(input.loanId);
      const event = {
        __typename: 'LoanManuallyDeniedEvent',
        LoanRequestID: input.loanId,
        ApproverName: input.ApproverName,
        LoanManualDecisionTimestamp: input.LoanManualDecisionTimestamp
      };
      record.manualDenials.push(event);
      return event;
    }
  },
  LoanDecisionEvents: {
    approvalsNeeded: (parent) => parent.approvalsNeeded ?? [],
    automaticApprovals: (parent) => parent.automaticApprovals ?? [],
    automaticDenials: (parent) => parent.automaticDenials ?? [],
    manualApprovals: (parent) => parent.manualApprovals ?? [],
    manualDenials: (parent) => parent.manualDenials ?? []
  },
  LoanDecisionEvent: {
    __resolveType: resolveDecisionType
  }
};

const port = Number(process.env.PORT ?? 4002);

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }])
});

startStandaloneServer(server, {
  listen: { port }
}).then(({ url }) => {
  console.log(`🚀 Loan decisions subgraph ready at ${url}`);
}).catch((error) => {
  console.error('Failed to start loan decisions subgraph', error);
});

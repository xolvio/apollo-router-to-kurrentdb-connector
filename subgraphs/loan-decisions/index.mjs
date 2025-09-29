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
    recordLoanApprovalNeeded(input: LoanApprovalNeededInput!, metadata: EventMetadataInput!): LoanApprovalNeededEvent!
    recordLoanAutomaticallyApproved(input: LoanAutomatedDecisionInput!, metadata: EventMetadataInput!): LoanAutomaticallyApprovedEvent!
    recordLoanAutomaticallyDenied(input: LoanAutomatedDecisionInput!, metadata: EventMetadataInput!): LoanAutomaticallyDeniedEvent!
    recordLoanManuallyApproved(input: LoanManualDecisionInput!, metadata: EventMetadataInput!): LoanManuallyApprovedEvent!
    recordLoanManuallyDenied(input: LoanManualDecisionInput!, metadata: EventMetadataInput!): LoanManuallyDeniedEvent!
  }

  interface LoanApplicationEvent {
    metadata: EventMetadata!
  }

  type EventMetadata @shareable {
    correlationId: ID!
    causationId: ID!
    transactionTimestamp: String!
  }

  input EventMetadataInput {
    correlationId: ID!
    causationId: ID!
    transactionTimestamp: String!
  }

  type LoanDecisionEvents {
    approvalsNeeded: [LoanApprovalNeededEvent!]!
    automaticApprovals: [LoanAutomaticallyApprovedEvent!]!
    automaticDenials: [LoanAutomaticallyDeniedEvent!]!
    manualApprovals: [LoanManuallyApprovedEvent!]!
    manualDenials: [LoanManuallyDeniedEvent!]!
  }

  union LoanDecisionEvent = LoanApprovalNeededEvent | LoanAutomaticallyApprovedEvent | LoanAutomaticallyDeniedEvent | LoanManuallyApprovedEvent | LoanManuallyDeniedEvent

  type LoanApprovalNeededEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  input LoanApprovalNeededInput {
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  type LoanAutomaticallyApprovedEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  type LoanAutomaticallyDeniedEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  input LoanAutomatedDecisionInput {
    LoanRequestID: ID!
    LoanAutomatedDecisionTimestamp: String!
  }

  type LoanManuallyApprovedEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    LoanRequestID: ID!
    ApproverName: String!
    LoanManualDecisionTimestamp: String!
  }

  type LoanManuallyDeniedEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    LoanRequestID: ID!
    ApproverName: String!
    LoanManualDecisionTimestamp: String!
  }

  input LoanManualDecisionInput {
    LoanRequestID: ID!
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

const shareRecord = (primaryKey, secondaryKey, record) => {
  if (secondaryKey && primaryKey !== secondaryKey) {
    loanDecisionStore.set(secondaryKey, record);
  }
};

const toMetadata = (input) => ({
  correlationId: input.correlationId,
  causationId: input.causationId,
  transactionTimestamp: input.transactionTimestamp
});

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
    recordLoanApprovalNeeded: (_, { input, metadata }) => {
      const key = metadata.correlationId ?? input.LoanRequestID;
      const record = ensureRecord(key);
      const event = {
        __typename: 'LoanApprovalNeededEvent',
        metadata: toMetadata(metadata),
        LoanRequestID: input.LoanRequestID,
        LoanAutomatedDecisionTimestamp: input.LoanAutomatedDecisionTimestamp
      };
      record.approvalsNeeded.push(event);
      shareRecord(key, input.LoanRequestID, record);
      return event;
    },
    recordLoanAutomaticallyApproved: (_, { input, metadata }) => {
      const key = metadata.correlationId ?? input.LoanRequestID;
      const record = ensureRecord(key);
      const event = {
        __typename: 'LoanAutomaticallyApprovedEvent',
        metadata: toMetadata(metadata),
        LoanRequestID: input.LoanRequestID,
        LoanAutomatedDecisionTimestamp: input.LoanAutomatedDecisionTimestamp
      };
      record.automaticApprovals.push(event);
      shareRecord(key, input.LoanRequestID, record);
      return event;
    },
    recordLoanAutomaticallyDenied: (_, { input, metadata }) => {
      const key = metadata.correlationId ?? input.LoanRequestID;
      const record = ensureRecord(key);
      const event = {
        __typename: 'LoanAutomaticallyDeniedEvent',
        metadata: toMetadata(metadata),
        LoanRequestID: input.LoanRequestID,
        LoanAutomatedDecisionTimestamp: input.LoanAutomatedDecisionTimestamp
      };
      record.automaticDenials.push(event);
      shareRecord(key, input.LoanRequestID, record);
      return event;
    },
    recordLoanManuallyApproved: (_, { input, metadata }) => {
      const key = metadata.correlationId ?? input.LoanRequestID;
      const record = ensureRecord(key);
      const event = {
        __typename: 'LoanManuallyApprovedEvent',
        metadata: toMetadata(metadata),
        LoanRequestID: input.LoanRequestID,
        ApproverName: input.ApproverName,
        LoanManualDecisionTimestamp: input.LoanManualDecisionTimestamp
      };
      record.manualApprovals.push(event);
      shareRecord(key, input.LoanRequestID, record);
      return event;
    },
    recordLoanManuallyDenied: (_, { input, metadata }) => {
      const key = metadata.correlationId ?? input.LoanRequestID;
      const record = ensureRecord(key);
      const event = {
        __typename: 'LoanManuallyDeniedEvent',
        metadata: toMetadata(metadata),
        LoanRequestID: input.LoanRequestID,
        ApproverName: input.ApproverName,
        LoanManualDecisionTimestamp: input.LoanManualDecisionTimestamp
      };
      record.manualDenials.push(event);
      shareRecord(key, input.LoanRequestID, record);
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
  LoanApplicationEvent: {
    __resolveType: resolveDecisionType
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

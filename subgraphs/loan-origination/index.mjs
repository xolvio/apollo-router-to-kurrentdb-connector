import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@shareable"])

  type Query {
    loanOriginationEvents(loanRequestId: ID!): LoanOriginationEvents!
  }

  type Mutation {
    recordLoanRequested(input: LoanRequestedInput!, metadata: EventMetadataInput!): LoanRequestedEvent!
    recordCreditChecked(input: CreditCheckedInput!, metadata: EventMetadataInput!): CreditCheckedEvent!
    recordAutomatedSummary(input: AutomatedSummaryInput!, metadata: EventMetadataInput!): AutomatedSummaryEvent!
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

  type LoanOriginationEvents {
    loanRequested: LoanRequestedEvent
    creditChecks: [CreditCheckedEvent!]!
    automatedSummaries: [AutomatedSummaryEvent!]!
  }

  union LoanOriginationEvent = LoanRequestedEvent | CreditCheckedEvent | AutomatedSummaryEvent

  type LoanApplicantAddress {
    Street: String!
    City: String!
    Region: String!
    Country: String!
    PostalCode: String!
  }

  input LoanApplicantAddressInput {
    Street: String!
    City: String!
    Region: String!
    Country: String!
    PostalCode: String!
  }

  type LoanRequestedEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    Amount: Float!
    LoanRequestID: ID!
    NationalID: String!
    Name: String!
    Gender: String!
    Age: Int!
    MaritalStatus: String!
    Dependents: Int!
    EducationLevel: String!
    EmployerName: String!
    JobTitle: String!
    JobSeniority: Float!
    Income: Float!
    Address: LoanApplicantAddress!
    LoanRequestedTimestamp: String!
    LoanProductID: Int
  }

  input LoanRequestedInput {
    Amount: Float!
    LoanRequestID: ID!
    NationalID: String!
    Name: String!
    Gender: String!
    Age: Int!
    MaritalStatus: String!
    Dependents: Int!
    EducationLevel: String!
    EmployerName: String!
    JobTitle: String!
    JobSeniority: Float!
    Income: Float!
    Address: LoanApplicantAddressInput!
    LoanRequestedTimestamp: String!
    LoanProductID: Int
  }

  type CreditCheckedEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    NationalID: String!
    Score: Int!
    CreditCheckedTimestamp: String!
  }

  input CreditCheckedInput {
    NationalID: String!
    Score: Int!
    CreditCheckedTimestamp: String!
  }

  type AutomatedSummaryEvent implements LoanApplicationEvent {
    metadata: EventMetadata!
    CreditScoreSummary: String!
    IncomeAndEmploymentSummary: String!
    LoanToIncomeSummary: String!
    MaritalStatusAndDependentsSummary: String!
    RecommendedFurtherInvestigation: String!
    SummarizedBy: String!
    SummarizedAt: String!
  }

  input AutomatedSummaryInput {
    CreditScoreSummary: String!
    IncomeAndEmploymentSummary: String!
    LoanToIncomeSummary: String!
    MaritalStatusAndDependentsSummary: String!
    RecommendedFurtherInvestigation: String!
    SummarizedBy: String!
    SummarizedAt: String!
  }
`;

const loanOriginationStore = new Map();

const ensureRecord = (loanRequestId) => {
  if (!loanOriginationStore.has(loanRequestId)) {
    loanOriginationStore.set(loanRequestId, {
      loanRequested: null,
      creditChecks: [],
      automatedSummaries: []
    });
  }
  return loanOriginationStore.get(loanRequestId);
};

const shareRecord = (primaryKey, secondaryKey, record) => {
  if (secondaryKey && primaryKey !== secondaryKey) {
    loanOriginationStore.set(secondaryKey, record);
  }
};

const toMetadata = (input) => ({
  correlationId: input.correlationId,
  causationId: input.causationId,
  transactionTimestamp: input.transactionTimestamp
});

const resolveOriginationType = (event) => event?.__typename ?? null;

const resolvers = {
  Query: {
    loanOriginationEvents: (_, { loanRequestId }) => {
      const record = ensureRecord(loanRequestId);
      return {
        loanRequested: record.loanRequested,
        creditChecks: record.creditChecks,
        automatedSummaries: record.automatedSummaries
      };
    }
  },
  Mutation: {
    recordLoanRequested: (_, { input, metadata }) => {
      const key = metadata.correlationId ?? input.LoanRequestID;
      const record = ensureRecord(key);
      const event = {
        __typename: 'LoanRequestedEvent',
        metadata: toMetadata(metadata),
        Amount: input.Amount,
        LoanRequestID: input.LoanRequestID,
        NationalID: input.NationalID,
        Name: input.Name,
        Gender: input.Gender,
        Age: input.Age,
        MaritalStatus: input.MaritalStatus,
        Dependents: input.Dependents,
        EducationLevel: input.EducationLevel,
        EmployerName: input.EmployerName,
        JobTitle: input.JobTitle,
        JobSeniority: input.JobSeniority,
        Income: input.Income,
        Address: { ...input.Address },
        LoanRequestedTimestamp: input.LoanRequestedTimestamp,
        LoanProductID: input.LoanProductID ?? null
      };
      record.loanRequested = event;
      shareRecord(key, input.LoanRequestID, record);
      return event;
    },
    recordCreditChecked: (_, { input, metadata }) => {
      const key = metadata.correlationId;
      const record = ensureRecord(key);
      const event = {
        __typename: 'CreditCheckedEvent',
        metadata: toMetadata(metadata),
        NationalID: input.NationalID,
        Score: input.Score,
        CreditCheckedTimestamp: input.CreditCheckedTimestamp
      };
      record.creditChecks.push(event);
      return event;
    },
    recordAutomatedSummary: (_, { input, metadata }) => {
      const key = metadata.correlationId;
      const record = ensureRecord(key);
      const event = {
        __typename: 'AutomatedSummaryEvent',
        metadata: toMetadata(metadata),
        CreditScoreSummary: input.CreditScoreSummary,
        IncomeAndEmploymentSummary: input.IncomeAndEmploymentSummary,
        LoanToIncomeSummary: input.LoanToIncomeSummary,
        MaritalStatusAndDependentsSummary: input.MaritalStatusAndDependentsSummary,
        RecommendedFurtherInvestigation: input.RecommendedFurtherInvestigation,
        SummarizedBy: input.SummarizedBy,
        SummarizedAt: input.SummarizedAt
      };
      record.automatedSummaries.push(event);
      return event;
    }
  },
  LoanOriginationEvents: {
    creditChecks: (parent) => parent.creditChecks ?? [],
    automatedSummaries: (parent) => parent.automatedSummaries ?? []
  },
  LoanApplicationEvent: {
    __resolveType: resolveOriginationType
  },
  LoanOriginationEvent: {
    __resolveType: resolveOriginationType
  }
};

const port = Number(process.env.PORT ?? 4001);

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }])
});

startStandaloneServer(server, {
  listen: { port }
}).then(({ url }) => {
  console.log(`🚀 Loan origination subgraph ready at ${url}`);
}).catch((error) => {
  console.error('Failed to start loan origination subgraph', error);
});


export const typeDefs = `
  type User {
    id: ID!
    email: String!
    created_at: String
  }

  type Asset {
    id: ID!
    filename: String!
    mime: String!
    size: Int!
    sha256: String
    status: String!
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type AssetEdge {
    cursor: String!
    node: Asset!
  }

  type PageInfo {
    endCursor: String
    hasNextPage: Boolean!
  }

  type AssetConnection {
    edges: [AssetEdge!]!
    pageInfo: PageInfo!
  }

  type UploadTicket {
    assetId: ID!
    storagePath: String!
    uploadUrl: String!
    expiresAt: String!
    nonce: String!
    version: Int!
  }

  type DownloadLink {
    url: String!
    expiresAt: String!
  }

  type SharedAsset {
    id: ID!
    asset_id: ID!
    owner_id: ID!
    shared_with_email: String!
    can_download: Boolean!
    revoked: Boolean!
    created_at: String!
  }


  type ShareResult {
    success: Boolean!
    message: String!
    share: SharedAsset
  }


  type TokenValidation {
    valid: Boolean!
    assetId: String!
  }

  type Query {
    me: User
    myAssets(after: String, first: Int, q: String): AssetConnection!
    listAssets: [Asset!]!
    getDownloadUrl(assetId: ID!): DownloadLink!
    validateDownloadToken(accessToken: String!): TokenValidation!
  }

  type Mutation {
    createUploadUrl(filename: String!, mime: String!, size: Int!): UploadTicket!
    getSignedDownloadUrl(filePath: String!): String!
    finalizeUpload(assetId: ID!, clientSha256: String!, version: Int!): Asset!
    renameAsset(assetId: ID!, filename: String!, version: Int!): Asset!
    deleteAsset(assetId: ID!, version: Int!): Boolean!
    shareAsset(assetId: ID!, toEmail: String!, canDownload: Boolean!, version: Int!): ShareResult!
    revokeShare(assetId: ID!, toEmail: String!, version: Int!): ShareResult!
  }
`;



# Graph Report - src  (2026-04-17)

## Corpus Check
- Corpus is ~22,827 words - fits in a single context window. You may not need a graph.

## Summary
- 178 nodes · 326 edges · 16 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_db.ts|db.ts]]
- [[_COMMUNITY_POST()|POST()]]
- [[_COMMUNITY_GET()|GET()]]
- [[_COMMUNITY_compliance.ts|compliance.ts]]
- [[_COMMUNITY_page.tsx|page.tsx]]
- [[_COMMUNITY_export.ts|export.ts]]
- [[_COMMUNITY_parsers.ts|parsers.ts]]
- [[_COMMUNITY_page.tsx|page.tsx]]
- [[_COMMUNITY_getSession()|getSession()]]
- [[_COMMUNITY_storage.ts|storage.ts]]
- [[_COMMUNITY_fetchUsers()|fetchUsers()]]
- [[_COMMUNITY_fetchStatus()|fetchStatus()]]
- [[_COMMUNITY_handleSubmit()|handleSubmit()]]
- [[_COMMUNITY_RootLayout()|RootLayout()]]
- [[_COMMUNITY_handleLogout()|handleLogout()]]
- [[_COMMUNITY_page.tsx|page.tsx]]

## God Nodes (most connected - your core abstractions)
1. `POST()` - 36 edges
2. `ensureDb()` - 28 edges
3. `GET()` - 22 edges
4. `DELETE()` - 13 edges
5. `getSession()` - 8 edges
6. `searchForRequirement()` - 8 edges
7. `buildDocument()` - 8 edges
8. `buildComplianceRows()` - 7 edges
9. `extractText()` - 7 edges
10. `synthesiseWithGemini()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `exportExcel()` --calls--> `GET()`  [INFERRED]
  src\app\(app)\generate\page.tsx → src\app\api\proposals\route.ts
- `POST()` --calls--> `logout()`  [INFERRED]
  src\app\api\knowledge-base\upload\route.ts → src\lib\auth.ts
- `exportWord()` --calls--> `GET()`  [INFERRED]
  src\app\(app)\history\page.tsx → src\app\api\proposals\route.ts
- `AppLayout()` --calls--> `getSession()`  [INFERRED]
  src\app\(app)\layout.tsx → src\lib\auth.ts
- `getSession()` --calls--> `GET()`  [INFERRED]
  src\lib\auth.ts → src\app\api\proposals\route.ts

## Communities

### Community 0 - "db.ts"
Cohesion: 0.13548387096774195
Nodes (30): countActiveUsers(), countDocuments(), countUserProposals(), createChunk(), createDocument(), createProposal(), createUser(), deleteAllDocuments() (+22 more)

### Community 1 - "POST()"
Cohesion: 0.12318840579710146
Nodes (13): chunkText(), generateEmbedding(), generateProposal(), saveGeneratedProposal(), searchSimilarChunks(), extractRequirementsFromExcel(), argb(), extractAttr() (+5 more)

### Community 2 - "GET()"
Cohesion: 0.14035087719298245
Nodes (8): getSetting(), listDocuments(), middleware(), verifySession(), exportWord(), DELETE(), escHtml(), GET()

### Community 3 - "compliance.ts"
Cohesion: 0.22794117647058823
Nodes (15): callGemini(), buildComplianceRows(), complianceWeight(), containsClientReference(), deriveShortQuery(), enforceTopChunkPrimacy(), expandRequirementForRetrieval(), extractComplianceTag() (+7 more)

### Community 4 - "page.tsx"
Cohesion: 0.17582417582417584
Nodes (5): addFilesToQueue(), onFileChange(), onFileDrop(), runQueue(), updateItem()

### Community 5 - "export.ts"
Cohesion: 0.2857142857142857
Nodes (13): buildContentTable(), buildCoverPage(), buildDocument(), buildDocxChildren(), buildPageFooter(), buildPageHeader(), deriveFilename(), deriveMetadata() (+5 more)

### Community 6 - "parsers.ts"
Cohesion: 0.2878787878787879
Nodes (10): detectColumnsWithGemini(), detectFileType(), extractText(), extractXlsxKbRows(), extractXmlText(), normalizeComplianceValue(), parseDocx(), parsePdf() (+2 more)

### Community 7 - "page.tsx"
Cohesion: 0.2727272727272727
Nodes (6): exportExcel(), handleKeyDown(), handleSend(), sendCompliance(), sendMessage(), uid()

### Community 8 - "getSession()"
Cohesion: 0.24444444444444444
Nodes (7): decrypt(), encrypt(), getSession(), login(), logout(), AppLayout(), HomePage()

### Community 9 - "storage.ts"
Cohesion: 0.4222222222222222
Nodes (9): ensureLocalDir(), localTemplateExists(), makeSafeFilename(), normalizeBlobPath(), removeStoredFile(), saveBlob(), saveMasterTemplate(), saveProposalUpload() (+1 more)

### Community 10 - "fetchUsers()"
Cohesion: 0.7
Nodes (4): fetchUsers(), handleCreateUser(), toggleUserRole(), toggleUserStatus()

### Community 11 - "fetchStatus()"
Cohesion: 0.8333333333333334
Nodes (3): fetchStatus(), handleRemove(), handleUpload()

### Community 12 - "handleSubmit()"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "RootLayout()"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "handleLogout()"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "page.tsx"
Cohesion: 0.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `handleSubmit()`** (2 nodes): `handleSubmit()`, `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `RootLayout()`** (2 nodes): `RootLayout()`, `layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `handleLogout()`** (2 nodes): `handleLogout()`, `Sidebar.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `POST()` connect `POST()` to `db.ts`, `GET()`, `compliance.ts`, `export.ts`, `parsers.ts`, `getSession()`, `storage.ts`?**
  _High betweenness centrality (0.462) - this node is a cross-community bridge._
- **Why does `GET()` connect `GET()` to `db.ts`, `POST()`, `compliance.ts`, `page.tsx`, `getSession()`, `storage.ts`?**
  _High betweenness centrality (0.394) - this node is a cross-community bridge._
- **Why does `exportExcel()` connect `page.tsx` to `GET()`?**
  _High betweenness centrality (0.211) - this node is a cross-community bridge._
- **Are the 23 inferred relationships involving `POST()` (e.g. with `getSession()` and `saveMasterTemplate()`) actually correct?**
  _`POST()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `GET()` (e.g. with `exportExcel()` and `exportWord()`) actually correct?**
  _`GET()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `DELETE()` (e.g. with `getSession()` and `listDocuments()`) actually correct?**
  _`DELETE()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `getSession()` (e.g. with `AppLayout()` and `GET()`) actually correct?**
  _`getSession()` has 6 INFERRED edges - model-reasoned connections that need verification._
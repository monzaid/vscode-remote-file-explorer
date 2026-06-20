# Contributing to Remote File Explorer

## Development Environment

1. **Clone and install:**
   ```bash
   git clone <repo-url>
   cd remote-file-explorer
   npm install
   ```

2. **Compile:**
   ```bash
   npm run compile
   ```

3. **Run in VSCode:**
   - Open the project in VSCode
   - Press F5 to launch Extension Development Host

## Code Structure

```
src/
├── core/           # Core logic: types, interfaces, managers
│   ├── types.ts
│   ├── IProtocolAdapter.ts
│   ├── ConnectionManager.ts
│   └── LocalCacheManager.ts
├── adapters/       # Protocol adapters (SSH, FTP, Agent)
│   ├── SSHAdapter.ts
│   ├── FTPAdapter.ts
│   └── AgentAdapter.ts
├── providers/      # VSCode providers (FS, TreeView, Conflict)
│   ├── RemoteFSProvider.ts
│   ├── SidebarProvider.ts
│   └── ConflictResolver.ts
├── search/         # Search engine
│   └── SearchEngine.ts
├── terminal/       # Terminal management
│   └── TerminalManager.ts
├── ui/             # UI components (StatusBar, Dialogs)
│   ├── StatusBarManager.ts
│   └── ConnectionDialog.ts
├── commands/       # Command implementations
│   ├── commandRegistry.ts
│   ├── menuCommands.ts
│   └── syncCommands.ts
├── test/           # Test suites
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── extension.ts    # Extension entry point
```

## Testing

- **Unit tests:** `npm run test:unit`
- **Integration tests:** `npm run test:integration` (requires Docker)
- **E2E tests:** `npm run test:e2e`

### Docker Test Environment

```bash
cd docker
docker compose up -d    # Start SSH + FTP containers
docker compose down     # Stop containers
```

## Commit Convention

We use conventional commits:
- `feat:` — New feature
- `fix:` — Bug fix
- `chore:` — Maintenance
- `test:` — Tests
- `docs:` — Documentation
- `perf:` — Performance improvements

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure lint passes: `npm run lint`
3. Ensure build passes: `npm run compile`
4. Update documentation if needed
5. Create PR with clear description

## License

MIT

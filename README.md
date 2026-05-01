# Developer Project Manager

A TypeScript CLI tool for managing development projects with two main features:

1. **Interactive CLI Chooser** - A styled two-option menu using @clack/prompts
2. **Parent Directory Scanner** - Discovers and tracks sibling projects with SQLite storage

## Features

### Interactive CLI Menu

When you run the main command, you can choose between:
- `hello` - prints a styled "hello" message
- `world` - prints a styled "world" message

### Parent Directory Management
The tool can scan the parent directory to:
- List all sibling project folders
- Check package.json versions and git status
- Store project information in a SQLite database
- Track project discovery and status over time

## Install

```bash
npm install
```

## Usage

### Interactive CLI Menu

```bash
npm start
```

### List Parent Directory Projects

```bash
npm run list
```

### Check Package Versions and Git Status

```bash
npm run versions
```

## Build

```bash
npm run build
```

## Optional Global Installation

After building, you can link the CLI command globally:

```bash
npm link
astro-chooser
```

## Database Storage

The tool uses SQLite to store project information in `parent-projects.db` with two tables:
- `parent_projects` - discovered project folders
- `parent_project_statuses` - package versions and git status tracking

## Dependencies

- **@clack/prompts** - Interactive CLI prompts
- **picocolors** - Terminal color styling  
- **Node.js SQLite** - Built-in database functionality
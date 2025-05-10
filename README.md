# Rawdirt

(Pure vibecoding. I apologize in advance.)

A Next.js application for viewing and managing .RW2 raw image files stored in an AWS S3 bucket.

## Features

- Browse raw files stored in S3
- View raw images in browser (using WASM-based decoding)
- Add and manage metadata (tags, titles, locations)
- Dark mode UI optimized for image viewing

## Getting Started

### Prerequisites

- Node.js (>= 18.x)
- An AWS S3 bucket containing .RW2 files
- AWS credentials with S3 read access

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env.local` file in the root directory with the following variables:

```
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=your_region
S3_BUCKET_NAME=your_bucket_name
```

### Running the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. The file browser panel on the left displays all .RW2 files in your S3 bucket
2. Click on a file to view it in the central panel
3. Use the metadata panel on the right to add tags, titles, and location information
4. Search for files using the search box in the file browser panel

## Deployment

For deployment to a VPS, you can build and run the application using:

```bash
npm run build
npm start
```

Or use a process manager like PM2:

```bash
npm install -g pm2
pm2 start npm --name "rawdirt" -- start
```

## Technical Details

- **Frontend**: Next.js with TypeScript and Material UI
- **Raw Decoding**: raw-decoder for handling .RW2 files
- **State Management**: Zustand for managing application state
- **API**: Server-side API routes for S3 integration

## License

MIT

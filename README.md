# Holded Kiosk

A monorepo application designed to provide a kiosk mode for Holded team capabilities for clocking employees. This application allows users to list employees, and perform clock-in and clock-out actions. 

It uses a Cloudflare Worker as a backend proxy to communicate with the Holded API and a Vue.js frontend for the user interface. 

## Screenshot

![Holded Kiosk Screenshot](/screenshot.png)


# BE AWARE
The Holded API token is stored locally in the browser's `localStorage`. Be aware of the security implications of storing sensitive information in the browser's `localStorage`.

At the moment, there is no encryption or protection for the token. Neither PIN or password to protect the token.

## Features

*   List employees from your Holded account with active contract and no termination.
*   Hide employes
*   Clock-in and Clock-out functionality for each employee. Today's clocked time.
*   Display the current status of each employee (clocked in or out).
*   Sync every 2 minutes to keep the status updated.
*   Responsive interface for kiosk usage, optimized for touchscreen devices as iPad Mini.
*   Search and colored avatar for each employee.
*   Quick view of current office status
*   Dark mode support (light, dark, and system preference)

## To Do
*  Separate by workplaces
*  Show leaves/holidays
*  Multilenguage
*  Dark mode


## Project Structure

The project is a monorepo containing two main parts:

*   `frontend/`: A Vue.js 3 application built with Vite.
*   `worker/`: A Cloudflare Worker script acting as a secure proxy to the Holded API.

## Prerequisites

Before you begin, ensure you have the following installed:

*   [Node.js](https://nodejs.org/) (version 18.x or later recommended)
*   [npm](https://www.npmjs.com/) (usually comes with Node.js)
*   [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/) (for deploying the Cloudflare Worker)
    ```bash
    npm install -g wrangler
    ```
*   A Holded account with API access. You will need to generate an API token from your Holded settings.

## Setup and Deployment

Follow these steps to set up and deploy the application:

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd holdedkiosk
```

### 2. Deploy the Cloudflare Worker
```bash
cd worker
wrangler login
```

#### 2.1 Configure the worker/wrangler.toml (optional)

```bash
name = "your-unique-worker-name" # Change this if needed
```
```bash
wrangler deploy
```
After successful deployment, Wrangler will output the URL of your worker (e.g., https://your-unique-worker-name.your-subdomain.workers.dev ). Copy this URL , as you'll need it for the frontend configuration.
### 3. Configure the Frontend
```bash
cd ../frontend
npm install
```
#### 3.1 Open the .env file and configure the following variables:
```bash
cp .env.example .env
```

#### Edit frontend/.env with your Cloudflare Worker URL
```bash
VITE_WORKER_BASE=https://your-unique-worker-name.your-subdomain.workers.dev
```
#### 3.2 Start the development server
```bash
npm run dev
```
The application should now be running at
### 4 Build the frontend
```bash
npm run build
```
### 5 Deploy the frontend
You can deploy the frontend to any static hosting service of your choice. For example, for Cloudflare Pages, you can run:
```bash
wrangler pages publish dist
```
### 6 Access the Kiosk
Open your web browser and navigate to the URL provided by the deployment process

## Usage
1. Access the Kiosk: Open your web browser and navigate to the URL provided by the deployment process.
2. Configure the Holded API Token: On the initial screen, enter your Holded API token.
3. List Employees: After configuring the token, you will see a list of employees from your Holded account.
4. Tap on each one to clock-in or clock-out.

# Contributing
Contributions are welcome! Please read our contribution guidelines before submitting a pull request.
# License
This project is licensed under the MIT License - see the LICENSE file for details.
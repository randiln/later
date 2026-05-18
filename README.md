# Hosting Your Application

This application is a React single-page application (SPA) built with Vite and Firebase. You can easily host it for free so others can test it. 

Here are the step-by-step instructions for deploying to **Vercel** (the easiest option) and **Firebase Hosting** (best if you want to keep everything in your existing Firebase project).

## Option 1: Deploy to Vercel (Easiest)

Vercel is a popular hosting platform for frontend frameworks and offers a generous free tier.

### Prerequisites
1. Create a free account at [Vercel](https://vercel.com/signup).
2. Create a free account at [GitHub](https://github.com/) (if you don't have one).

### Steps
1. **Export your code:** In AI Studio, click the settings menu/kebab icon and export your project as a ZIP file or directly to a GitHub repository.
2. **Push to GitHub (if using ZIP):** Extract the ZIP and push the code to a new public or private repository on your GitHub account.
3. **Import to Vercel:**
   - Go to your Vercel Dashboard and click **"Add New..." > "Project"**.
   - Connect your GitHub account and select your repository.
   - Click **"Import"**.
4. **Configure Project:**
   - **Framework Preset:** Vercel should automatically detect **Vite**.
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. **Add Environment Variables:**
   - If your app uses any `.env` variables (e.g., API keys), add them in the "Environment Variables" section before deploying.
6. **Deploy:** Click **"Deploy"**. Vercel will build and host your app. Once finished, you will receive a free `*.vercel.app` domain to share with your users!

---

## Option 2: Deploy to Firebase Hosting

Since this app already uses Firebase for Authentication, Firestore, and Storage, Firebase Hosting is a great choice and offers excellent free-tier limits.

### Prerequisites
1. Install [Node.js](https://nodejs.org/) on your computer.
2. Export your project from AI Studio as a ZIP file and extract it on your computer.

### Steps
1. **Install Firebase CLI:** Open your computer's terminal or command prompt and run:
   ```bash
   npm install -g firebase-tools
   ```
2. **Login to Firebase:**
   ```bash
   firebase login
   ```
   *Follow the prompts in your browser to log in with the Google account you used to set up your Firebase project.*
3. **Initialize Firebase in your project:**
   Navigate to your extracted project folder in the terminal and run:
   ```bash
   firebase init hosting
   ```
   During initialization, answer the prompts as follows:
   - *Please select an option:* Select **Use an existing project** and choose the Firebase project you created for this app.
   - *What do you want to use as your public directory?* Type **dist** and press Enter.
   - *Configure as a single-page app (rewrite all urls to /index.html)?* Type **Yes** (y) and press Enter.
   - *Set up automatic builds and deploys with GitHub?* Type **No** (N) and press Enter.
4. **Build the application:**
   In your terminal, run the build command to generate the `dist` folder:
   ```bash
   npm run build
   ```
5. **Deploy:**
   Run the following command to deploy your app:
   ```bash
   firebase deploy --only hosting
   ```
6. **Share:** Once deployment completes, your terminal will output a "Hosting URL" (e.g., `https://your-project-id.web.app`). You can share this link with anyone!

---

## Important Post-Deployment Step (OAuth/Login)

Since you are deploying to a new domain, you must add it to Firebase Authentication so Google login works correctly.

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project.
3. Click **Authentication** in the left sidebar, then go to the **Settings** tab.
4. Select **Authorized domains**.
5. Click **Add domain** and enter your new custom domain (e.g., `your-app.vercel.app` or `your-project.web.app`). You do not need to include `https://`.
6. Save. Google Login will now work on your newly hosted site!

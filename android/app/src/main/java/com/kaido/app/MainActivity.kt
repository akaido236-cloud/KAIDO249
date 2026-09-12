package com.kaido.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/**
 * The KAIDO Android shell.
 *
 * This first shell is deliberately minimal: it hosts the KAIDO web surface in
 * a WebView and exposes a small, explicit JavaScript bridge so the page can ask
 * Android for things later. Keeping it small means the first CI build succeeds
 * and the security review is trivial.
 *
 * What this shell deliberately does NOT do yet:
 *   - It does not request camera, microphone, contacts, location or
 *     notification-listener access.
 *   - It does not run background work.
 *   - It does not execute commands; that is the Termux bridge's job, and every
 *     command is validated there.
 *
 * Each capability arrives in a later shell, behind its own visible grant.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // No file:// access from the web surface, and no mixed content.
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d("KAIDO", "${msg.message()} @ ${msg.lineNumber()}")
                return true
            }
        }

        // The runtime URL is configured at build time; the shell ships inert
        // (no server) rather than pointing at something arbitrary.
        val startUrl = BuildConfig.RUNTIME_URL
        if (startUrl.isNullOrBlank()) {
            webView.loadDataWithBaseURL(
                null,
                localStatusPage(),
                "text/html",
                "utf-8",
                null,
            )
        } else {
            webView.loadUrl(startUrl)
        }
    }

    /** Shown when no runtime URL is configured — honest, not a blank screen. */
    private fun localStatusPage(): String = """
        <!doctype html>
        <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body{background:#0b0d10;color:#e6e8ea;font:15px/1.6 system-ui,sans-serif;padding:28px}
          h1{font-size:20px;margin:0 0 4px}
          .muted{color:#8b929a;margin-bottom:20px}
          li{margin:6px 0}
          code{background:#151a20;padding:2px 6px;border-radius:4px;font-size:13px}
        </style></head><body>
        <h1>KAIDO</h1>
        <div class="muted">Android shell — runtime not configured</div>
        <p>This shell is alive and holds <strong>no</strong> dangerous permissions.</p>
        <ul>
          <li>Camera, microphone, contacts, location: <strong>not requested</strong></li>
          <li>Notification access: <strong>not requested</strong></li>
          <li>Command execution: <strong>not in this shell</strong></li>
        </ul>
        <p>To connect a runtime, rebuild with <code>-PkaidoRuntimeUrl=https://…</code>.</p>
        </body></html>
    """.trimIndent()
}

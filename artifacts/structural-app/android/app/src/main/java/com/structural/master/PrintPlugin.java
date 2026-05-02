package com.structural.master;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PrintPlugin")
public class PrintPlugin extends Plugin {

    @PluginMethod
    public void printHTML(PluginCall call) {
        String html = call.getString("html", "");
        String jobName = call.getString("jobName", "Structural Master Print");

        if (html == null || html.isEmpty()) {
            call.reject("No HTML content provided");
            return;
        }

        final String finalHtml = html;
        final String finalJobName = jobName;

        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                WebView webView = new WebView(getContext());
                webView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        PrintManager printManager =
                            (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);

                        PrintDocumentAdapter printAdapter =
                            webView.createPrintDocumentAdapter(finalJobName);

                        PrintAttributes.Builder builder = new PrintAttributes.Builder();
                        builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4);
                        builder.setResolution(
                            new PrintAttributes.Resolution("default", "default", 300, 300));
                        builder.setMinMargins(PrintAttributes.Margins.NO_MARGINS);

                        PrintJob printJob = printManager.print(
                            finalJobName, printAdapter, builder.build());

                        call.resolve();
                    }
                });

                webView.getSettings().setJavaScriptEnabled(true);
                webView.getSettings().setDomStorageEnabled(true);
                webView.loadDataWithBaseURL(
                    "https://localhost",
                    finalHtml,
                    "text/html",
                    "UTF-8",
                    null
                );
            } catch (Exception e) {
                call.reject("Print failed: " + e.getMessage());
            }
        });
    }
}

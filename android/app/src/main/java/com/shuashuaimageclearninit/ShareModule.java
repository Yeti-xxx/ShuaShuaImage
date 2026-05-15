package com.shuashuaimageclearninit;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class ShareModule extends ReactContextBaseJavaModule implements ActivityEventListener {

    private static final int SHARE_REQUEST_CODE = 12345;
    private Promise pendingPromise;

    public ShareModule(ReactApplicationContext reactContext) {
        super(reactContext);
        reactContext.addActivityEventListener(this);
    }

    @NonNull
    @Override
    public String getName() {
        return "NativeShare";
    }

    @ReactMethod
    public void share(String uriString, String mimeType, Promise promise) {
        try {
            Uri uri = Uri.parse(uriString);
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(shareIntent, "分享");
            pendingPromise = promise;

            if (getCurrentActivity() != null) {
                getCurrentActivity().startActivityForResult(chooser, SHARE_REQUEST_CODE);
            } else {
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getReactApplicationContext().startActivity(chooser);
                promise.resolve(true);
                pendingPromise = null;
            }
        } catch (Exception e) {
            promise.reject("SHARE_ERROR", e.getMessage());
            pendingPromise = null;
        }
    }

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode == SHARE_REQUEST_CODE && pendingPromise != null) {
            pendingPromise.resolve(true);
            pendingPromise = null;
        }
    }

    @Override
    public void onNewIntent(Intent intent) {}
}

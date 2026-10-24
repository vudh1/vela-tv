package com.danielvu.quiethome;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Restricted, read-only APK URI for the Android system installer only. */
public final class VelaApkProvider extends ContentProvider {
    private File file(Uri uri) throws FileNotFoundException {
        if (uri == null || !"/updates/vela-update.apk".equals(uri.getPath()))
            throw new FileNotFoundException("Invalid update path");
        File apk = new File(new File(getContext().getCacheDir(), "updates"), "vela-update.apk");
        if (!apk.isFile()) throw new FileNotFoundException("Update not downloaded");
        return apk;
    }
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only update");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        try {
            File apk = file(uri);
            String[] cols = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor c = new MatrixCursor(cols);
            Object[] row = new Object[cols.length];
            for (int i=0; i<cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = "Vela-release.apk";
                else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = apk.length();
            }
            c.addRow(row);
            return c;
        } catch (FileNotFoundException e) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException("Read-only"); }
}

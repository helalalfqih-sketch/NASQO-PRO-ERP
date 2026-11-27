package com.indexesstore.nasqo_pro_erp;

/** UI-thread-only ownership of one Android runtime permission request. */
public final class HybridCameraRequestGate {
    public interface Completion { void complete(boolean granted); }
    private boolean outstanding;
    private Object owner;
    private Completion completion;

    public boolean begin(Object requestOwner, Completion callback) {
        if (outstanding || requestOwner == null || callback == null) return false;
        outstanding = true;
        owner = requestOwner;
        completion = callback;
        return true;
    }

    public void cancel(Object requestOwner) {
        if (owner != requestOwner) return;
        Completion callback = completion;
        owner = null;
        completion = null;
        // Do not reuse the OS request code until its result arrives.
        if (callback != null) callback.complete(false);
    }

    public void finish(boolean granted) {
        Completion callback = completion;
        outstanding = false;
        owner = null;
        completion = null;
        if (callback != null) callback.complete(granted);
    }
}

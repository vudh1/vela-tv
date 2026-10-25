package com.danielvu.quiethome;

public final class VelaInstallPermissionFlowTest {
    private static void equals(Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual))
            throw new AssertionError("Expected " + expected + " but got " + actual);
    }

    public static void main(String[] args) {
        VelaInstallPermissionFlow flow = new VelaInstallPermissionFlow();
        equals(VelaInstallPermissionFlow.Action.OPEN_SETTINGS, flow.onInstallRequest(false));
        equals(VelaInstallPermissionFlow.Action.BLOCKED, flow.onResume(false));
        equals(VelaInstallPermissionFlow.Action.BLOCKED, flow.onInstallRequest(false));
        equals(null, flow.onResume(false));
        // User eventually enables the permission: retry proceeds without another settings trip.
        equals(VelaInstallPermissionFlow.Action.INSTALL, flow.onInstallRequest(true));
        equals(VelaInstallPermissionFlow.Action.OPEN_SETTINGS, flow.onInstallRequest(false));
        equals(VelaInstallPermissionFlow.Action.INSTALL, flow.onResume(true));
        equals(null, flow.onResume(true));

        VelaInstallPermissionFlow allowed = new VelaInstallPermissionFlow();
        equals(VelaInstallPermissionFlow.Action.INSTALL, allowed.onInstallRequest(true));
        equals(null, allowed.onResume(true));
        System.out.println("Vela install permission flow passed");
    }
}

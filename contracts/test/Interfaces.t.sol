// Checks the public contract surface and failure-severity ordering.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IJobMarket} from "../src/IJobMarket.sol";
import {INodeRegistry} from "../src/INodeRegistry.sol";

contract InterfacesTest is Test {
    function test_interfaceIdsAreStable() public pure {
        // Pin selectors so an accidental ABI change fails before consumers are built.
        assertEq(type(IJobMarket).interfaceId, bytes4(0xe8c372ce), "IJobMarket");
        assertEq(type(INodeRegistry).interfaceId, bytes4(0x7f590dff), "INodeRegistry");
    }

    function test_kindIsOrderedBySeverity() public pure {
        assertLt(uint8(IJobMarket.Kind.ReplayDrift), uint8(IJobMarket.Kind.DataUnavailable));
        assertLt(uint8(IJobMarket.Kind.DataUnavailable), uint8(IJobMarket.Kind.ReplayMismatch));
    }
}

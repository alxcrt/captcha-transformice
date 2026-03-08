package org.transformice.packets.recv.newpackets;

// Imports
import org.bytearray.ByteArray;
import org.transformice.Client;
import org.transformice.packets.RecvPacket;
import org.transformice.packets.send.newpackets.C_ViewLeaderboard;

@SuppressWarnings("unused")
public final class S_ViewLeaderboard implements RecvPacket {
    @Override
    public void handle(Client client, int fingerPrint, ByteArray data) {
        client.sendPacket(new C_ViewLeaderboard(client.getPlayerName()));
    }

    @Override
    public int getC() {
        return 149;
    }

    @Override
    public int getCC() {
        return 21;
    }

    @Override
    public boolean isLegacyPacket() {
        return false;
    }
}
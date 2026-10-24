package org.transformice.connection;

// Imports
import java.net.InetSocketAddress;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.handler.codec.CorruptedFrameException;
import io.netty.util.ReferenceCountUtil;
import org.bytearray.ByteArray;
import org.transformice.Application;
import org.transformice.Client;
import org.transformice.Server;
import org.transformice.packets.PacketStruct;

public final class ClientHandler extends ChannelInboundHandlerAdapter {
    private final Server server;

    public ClientHandler(Server server) {
        this.server = server;
    }

    @Override
    public void channelInactive(ChannelHandlerContext context) {
        Client client = context.channel().attr(Server.CLIENT_SESSION).get();
        if (client != null) {
            client.closeConnection();
        }

        this.server.removeClientSession(context.channel());
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        Application.getLogger().error(Application.getTranslationManager().get("packeterror"), cause);
        if (cause instanceof CorruptedFrameException) {
            ctx.channel().close();
        }
    }

    @Override
    public void channelRead(ChannelHandlerContext context, Object message) {
        if (!(message instanceof ByteArray packet)) {
            ReferenceCountUtil.release(message);
            return;
        }

        if(this.server.getTempBlackList().contains(((InetSocketAddress)context.channel().remoteAddress()).getAddress().getHostAddress())) {
            context.channel().close();
            return;
        }

        if (packet.getLength() < 3) {
            return;
        }

        Client client = context.channel().attr(Server.CLIENT_SESSION).get();
        if (client == null) {
            this.server.addClientSession(context.channel());
            client = context.channel().attr(Server.CLIENT_SESSION).get();
        }

        int fingerPrint = packet.readUnsignedByte();
        int C = packet.readUnsignedByte();
        int CC = packet.readUnsignedByte();
        boolean isLegacy = false;
        if(C == 1 && CC == 1) {
            isLegacy = true;
            packet.readShort(); // packet length
            C = packet.readByte();
            CC = packet.readByte();
            if(packet.getLength() > 0) packet.readByte(); // 01
        }

        if(this.server.getBlacklistedPackets().contains(((C << 8) | (CC & 0xFF)))) {
            return;
        }

        var handler = client.getServer().getPacketHandler().getHandlers().get(new PacketStruct(((C << 8) | (CC & 0xFF)), isLegacy));
        if (handler != null) {
            Application.getLogger().debug(Application.getTranslationManager().get("receivedpacket", isLegacy ? "[Legacy]" : "", client.getIpAddress(), C, CC));
            handler.handle(client, fingerPrint, packet);
        } else {
            Application.getLogger().warn(Application.getTranslationManager().get("unhandledpacket", isLegacy ? "[Legacy]" : "", C, CC));
        }
    }
}
